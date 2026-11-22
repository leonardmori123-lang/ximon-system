// recordPoReceipt: what Purchasing does when Delivery receives goods against a purchase order.
// Real database, real server. Purchase orders are made the way the screens make them (RF, PR, prices,
// approval, PO), so the lines are exactly what Delivery will find.
const test = require('node:test');
const assert = require('node:assert');
const { db, start, stop, loginAs, call, user, itemId, rfBody } = require('./helpers');
const { recordPoReceipt } = require('../server/services/poReceipts');
const { createPurchaseRequisition } = require('../server/services/handoff');

test.before(async () => {
  db.run('UPDATE Project SET MaterialBudgetCentavos = 0'); // the budget check is not what these tests are about
  await start();
});
test.after(stop);

const verifier = user('verifier1');
const json = async (res, status) => { assert.strictEqual(res.status, status, await res.clone().text()); return res.json(); };
const rejects = (fn, status, text) => assert.throws(fn, (e) => e.status === status && (!text || e.message.includes(text)), `expected ${status} ${text || ''}`);

// The seeded supplier prices a PR, the owner approves it, the purchaser makes the PO. Returns the PO id.
async function poFromPr(prId) {
  const purchaser = await loginAs('purchaser1');
  const owner = await loginAs('owner1');
  const detail = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  const supplierId = db.get(`SELECT SupplierId AS id FROM Supplier WHERE Name LIKE 'Sample HDPE%'`).id;
  await json(await call('PUT', `/api/purchasing/prs/${prId}/prices`, purchaser, {
    supplierId, lines: detail.lines.map((l) => ({ prLineId: l.PrLineId, unitPriceCentavos: 50000 })),
  }), 200);
  await json(await call('POST', `/api/purchasing/prs/${prId}/approve`, owner, {}), 200);
  return (await json(await call('POST', `/api/purchasing/prs/${prId}/po`, purchaser, {}), 201)).id;
}

// An approved RF with no stock behind it, so every line is short. rows: [['ACU-001', 2]]. Returns { poId, rfId }.
async function poWithRf(rows) {
  for (const [code] of rows) db.run('UPDATE Item SET OnHand = 0, Reserved = 0 WHERE Code = @code', { code });
  const rf = await json(await call('POST', '/api/requisitions', await loginAs('foreman1'), rfBody(rows)), 201);
  await json(await call('POST', `/api/requisitions/${rf.id}/approve`, await loginAs('owner1')), 200);
  const prId = db.get('SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE RequisitionId = @id', { id: rf.id }).id;
  return { poId: await poFromPr(prId), rfId: rf.id };
}

// A purchase requisition that restocks the shelf, with no RF behind it.
async function poWithoutRf(code, shortQty) {
  const { id } = db.transaction(() => createPurchaseRequisition({
    requisitionId: null, rfNumber: 'RF-NONE', projectId: db.get('SELECT ProjectId FROM Project LIMIT 1').ProjectId, userId: user('owner1').id,
    lines: [{ itemId: itemId(code), shortQty }],
  }));
  const prId = id || db.get('SELECT MAX(PurchaseRequisitionId) AS id FROM PurchaseRequisition').id;
  return poFromPr(prId);
}

const lines = (poId) => db.all('SELECT PoLineId, ItemId, Quantity, QtyReceived FROM POLine WHERE PurchaseOrderId = @poId ORDER BY PoLineId', { poId }).map((l) => ({ ...l }));
const lineOf = (poId, code) => lines(poId).find((l) => l.ItemId === itemId(code));
const statusOf = (poId) => db.get('SELECT Status FROM PurchaseOrder WHERE PurchaseOrderId = @poId', { poId }).Status;
const history = (poId) => db.all(`SELECT FromStatus, ToStatus, ChangedBy, Reason FROM StatusHistory WHERE DocType = 'PO' AND DocId = @poId ORDER BY HistoryId`, { poId }).map((h) => ({ ...h }));
const receive = (poId, rows, reportNumber) => recordPoReceipt({
  poId, userId: verifier.id, reportNumber,
  lines: rows.map(([poLineId, quantity]) => ({ poLineId, quantity })),
});

test('receiving everything closes the purchase order and tells Delivery what to put on the shelf', async () => {
  const { poId, rfId } = await poWithRf([['ACU-001', 2]]);
  const line = lineOf(poId, 'ACU-001');
  assert.deepStrictEqual({ status: statusOf(poId), received: line.QtyReceived }, { status: 'open', received: 0 });

  const out = receive(poId, [[line.PoLineId, 2]], 'RR-TEST-1');
  const po = db.get('SELECT PoNumber, ProjectId FROM PurchaseOrder WHERE PurchaseOrderId = @poId', { poId });
  assert.deepStrictEqual(out, {
    poId, poNumber: po.PoNumber, poStatus: 'closed', projectId: po.ProjectId, requisitionId: rfId,
    lines: [{ poLineId: line.PoLineId, itemId: itemId('ACU-001'), quantity: 2 }],
  });
  assert.deepStrictEqual({ status: statusOf(poId), received: lineOf(poId, 'ACU-001').QtyReceived }, { status: 'closed', received: 2 });
  assert.deepStrictEqual(history(poId), [
    { FromStatus: null, ToStatus: 'open', ChangedBy: user('purchaser1').id, Reason: null },
    { FromStatus: 'open', ToStatus: 'closed', ChangedBy: verifier.id, Reason: 'Received on RR-TEST-1' },
  ]);
});

test('a partial delivery makes it partly delivered, and it closes only when every line is complete', async () => {
  const { poId } = await poWithRf([['HDPE-002', 5], ['HDPE-003', 3]]);
  const a = lineOf(poId, 'HDPE-002').PoLineId;
  const b = lineOf(poId, 'HDPE-003').PoLineId;

  assert.strictEqual(receive(poId, [[a, 2]], 'RR-TEST-2').poStatus, 'partly_delivered');
  assert.strictEqual(receive(poId, [[a, 3]], 'RR-TEST-3').poStatus, 'partly_delivered', 'the second line is still open');
  assert.deepStrictEqual(lines(poId).map((l) => l.QtyReceived), [5, 0]);
  assert.strictEqual(receive(poId, [[b, 1]], 'RR-TEST-4').poStatus, 'partly_delivered');
  const last = receive(poId, [[b, 2]], 'RR-TEST-5');
  assert.strictEqual(last.poStatus, 'closed');
  assert.deepStrictEqual(lines(poId).map((l) => l.QtyReceived), [5, 3]);

  // A history row is written only when the status changes, and it names the report that changed it.
  assert.deepStrictEqual(history(poId).map((h) => [h.FromStatus, h.ToStatus, h.Reason]), [
    [null, 'open', null],
    ['open', 'partly_delivered', 'Received on RR-TEST-2'],
    ['partly_delivered', 'closed', 'Received on RR-TEST-5'],
  ]);
});

test('one report can carry several lines', async () => {
  const { poId } = await poWithRf([['HDPE-004', 2], ['HDPE-005', 4]]);
  const out = receive(poId, [[lineOf(poId, 'HDPE-004').PoLineId, 2], [lineOf(poId, 'HDPE-005').PoLineId, 4]], 'RR-TEST-6');
  assert.strictEqual(out.poStatus, 'closed');
  assert.deepStrictEqual(out.lines.map((l) => [l.itemId, l.quantity]), [[itemId('HDPE-004'), 2], [itemId('HDPE-005'), 4]]);
});

test('decimal quantities add up without drifting: 0.1 and 0.2 complete 0.3', async () => {
  const { poId } = await poWithRf([['HDPE-006', 0.3]]);
  const id = lineOf(poId, 'HDPE-006').PoLineId;
  assert.strictEqual(receive(poId, [[id, 0.1]]).poStatus, 'partly_delivered');
  assert.strictEqual(receive(poId, [[id, 0.2]]).poStatus, 'closed');
  assert.strictEqual(lineOf(poId, 'HDPE-006').QtyReceived, 0.3);
});

test('more than is outstanding is refused and nothing changes', async () => {
  const { poId } = await poWithRf([['HDPE-002', 4]]);
  const id = lineOf(poId, 'HDPE-002').PoLineId;
  receive(poId, [[id, 3]]);
  const before = { lines: lines(poId), status: statusOf(poId), history: history(poId) };

  rejects(() => receive(poId, [[id, 2]]), 400, 'only 1 still to receive');
  rejects(() => receive(poId, [[id, 1.01]]), 400, 'only 1 still to receive');
  assert.deepStrictEqual({ lines: lines(poId), status: statusOf(poId), history: history(poId) }, before);
  assert.strictEqual(receive(poId, [[id, 1]]).poStatus, 'closed', 'exactly what is outstanding is fine');
});

test('bad input is refused with a plain message and nothing changes', async () => {
  const { poId } = await poWithRf([['HDPE-003', 3]]);
  const other = await poWithRf([['ACU-001', 3]]);
  const mine = lineOf(poId, 'HDPE-003').PoLineId;
  const theirs = lineOf(other.poId, 'ACU-001').PoLineId;
  const before = { mine: lines(poId), theirs: lines(other.poId) };
  const base = { poId, userId: verifier.id, lines: [{ poLineId: mine, quantity: 1 }] };

  rejects(() => recordPoReceipt(undefined), 400);
  rejects(() => recordPoReceipt({ ...base, poId: undefined }), 400, 'poId');
  rejects(() => recordPoReceipt({ ...base, userId: undefined }), 400, 'userId');
  rejects(() => recordPoReceipt({ ...base, lines: [] }), 400, 'List the received lines');
  rejects(() => recordPoReceipt({ ...base, lines: undefined }), 400, 'List the received lines');
  for (const quantity of [0, -1, 1.234, '1', null, NaN]) {
    rejects(() => recordPoReceipt({ ...base, lines: [{ poLineId: mine, quantity }] }), 400, 'above zero');
  }
  rejects(() => recordPoReceipt({ ...base, lines: [{ quantity: 1 }] }), 400, 'poLineId');
  rejects(() => recordPoReceipt({ ...base, lines: [{ poLineId: mine, quantity: 1 }, { poLineId: mine, quantity: 1 }] }), 400, 'only once');
  rejects(() => recordPoReceipt({ ...base, lines: [{ poLineId: theirs, quantity: 1 }] }), 400, 'is not on');
  rejects(() => recordPoReceipt({ ...base, lines: [{ poLineId: 999999, quantity: 1 }] }), 400, 'is not on');
  rejects(() => recordPoReceipt({ ...base, poId: 999999 }), 404, 'Purchase order not found');
  assert.deepStrictEqual({ mine: lines(poId), theirs: lines(other.poId) }, before);
  assert.strictEqual(statusOf(poId), 'open');
});

test('a closed purchase order takes nothing more', async () => {
  const { poId } = await poWithRf([['ACU-001', 1]]);
  const id = lineOf(poId, 'ACU-001').PoLineId;
  receive(poId, [[id, 1]]);
  const before = history(poId);
  rejects(() => receive(poId, [[id, 1]]), 409, 'already closed');
  assert.deepStrictEqual(history(poId), before);
  assert.strictEqual(lineOf(poId, 'ACU-001').QtyReceived, 1);
});

test('all or nothing: a good line followed by a bad one saves neither', async () => {
  const { poId } = await poWithRf([['HDPE-004', 2], ['HDPE-005', 2]]);
  const a = lineOf(poId, 'HDPE-004').PoLineId;
  const b = lineOf(poId, 'HDPE-005').PoLineId;
  rejects(() => receive(poId, [[a, 2], [b, 3]]), 400, 'only 2 still to receive');
  assert.deepStrictEqual(lines(poId).map((l) => l.QtyReceived), [0, 0]);
  assert.strictEqual(statusOf(poId), 'open');
  assert.strictEqual(history(poId).length, 1);
});

test('it runs inside the caller\'s transaction, so a failure later in the report undoes it', async () => {
  const { poId } = await poWithRf([['HDPE-006', 2]]);
  const id = lineOf(poId, 'HDPE-006').PoLineId;
  assert.throws(() => db.transaction(() => {
    receive(poId, [[id, 2]], 'RR-TEST-X');
    assert.strictEqual(statusOf(poId), 'closed', 'visible inside the transaction');
    throw new Error('the rest of the report failed');
  }), /the rest of the report failed/);
  assert.deepStrictEqual({ received: lineOf(poId, 'HDPE-006').QtyReceived, status: statusOf(poId), rows: history(poId).length }, { received: 0, status: 'open', rows: 1 });
});

test('a purchase order whose purchase requisition has no RF returns requisitionId null', async () => {
  const poId = await poWithoutRf('HDPE-001', 2);
  const out = receive(poId, [[lineOf(poId, 'HDPE-001').PoLineId, 1]]);
  assert.strictEqual(out.requisitionId, null);
  assert.strictEqual(out.poStatus, 'partly_delivered');
  assert.strictEqual(out.lines[0].itemId, itemId('HDPE-001'));
});

test('it does not touch stock: putting units on the shelf is receiveStock\'s job', async () => {
  const { poId } = await poWithRf([['HDPE-005', 2]]);
  const stock = () => db.get('SELECT OnHand, Reserved FROM Item WHERE Code = @code', { code: 'HDPE-005' });
  const logged = () => db.get('SELECT COUNT(*) AS n FROM StockTransaction').n;
  const before = { stock: { ...stock() }, logged: logged() };
  receive(poId, [[lineOf(poId, 'HDPE-005').PoLineId, 2]]);
  assert.deepStrictEqual({ stock: { ...stock() }, logged: logged() }, before);
});
