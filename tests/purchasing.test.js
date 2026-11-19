// Purchasing, build steps 1 to 4: the purchase requisition made from an RF shortage, suppliers and
// their prices, pricing a purchase requisition, and the owner's decision on it (approve, hold, cancel).
// Real database, real server.
const test = require('node:test');
const assert = require('node:assert');
const { db, start, stop, loginAs, call, itemId, rfBody, user } = require('./helpers');
const rules = require('../server/services/purchasingRules');

test.before(start);
test.after(stop);

const json = async (res, status) => { assert.strictEqual(res.status, status, await res.clone().text()); return res.json(); };
const SEEDED = 'Sample HDPE Supplier (test data)';
const supplierId = (name = SEEDED) => db.get('SELECT SupplierId AS id FROM Supplier WHERE Name = @name', { name }).id;
const notices = (username, like) => db.all(
  'SELECT Message, LinkUrl FROM Notification WHERE UserId = @id AND Message LIKE @like ORDER BY NotificationId',
  { id: user(username).id, like });

// Files an RF as foreman1 and approves it as owner1. ACU-001 has no stock, so the whole quantity is short.
async function shortagePr(lines = [['ACU-001', 2]]) {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const rf = await json(await call('POST', '/api/requisitions', foreman, rfBody(lines)), 201);
  const approved = await json(await call('POST', `/api/requisitions/${rf.id}/approve`, owner), 200);
  const pr = db.get('SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE RequisitionId = @id', { id: rf.id });
  return { rf, approved, prId: pr && pr.id };
}

const prNumberOf = (prId) => db.get('SELECT PrNumber FROM PurchaseRequisition WHERE PurchaseRequisitionId = @prId', { prId }).PrNumber;
const rfNumberOf = (rfId) => db.get('SELECT RfNumber FROM Requisition WHERE RequisitionId = @rfId', { rfId }).RfNumber;
const prRow = (prId) => ({ ...db.get('SELECT Status, Reason, DecidedBy FROM PurchaseRequisition WHERE PurchaseRequisitionId = @prId', { prId }) });
const historyOf = (prId) => db.all(
  `SELECT FromStatus, ToStatus, Reason FROM StatusHistory WHERE DocType = 'PR' AND DocId = @prId ORDER BY HistoryId`, { prId }
).map((row) => ({ ...row }));

// The purchaser saves the seeded supplier and one price on every line of the PR.
async function priceIt(prId, purchaser, unitPriceCentavos = 99900) {
  const detail = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  const lines = detail.lines.map((l) => ({ prLineId: l.PrLineId, unitPriceCentavos }));
  await json(await call('PUT', `/api/purchasing/prs/${prId}/prices`, purchaser, { supplierId: supplierId(), lines }), 200);
}

// The owner presses approve, hold or cancel. No reason argument sends a body without one.
const decide = (owner, prId, action, reason) => call('POST', `/api/purchasing/prs/${prId}/${action}`, owner, reason === undefined ? {} : { reason });

// ---------- Rules with no database ----------

test('unit prices are whole centavos above zero', () => {
  assert.strictEqual(rules.checkUnitPrice(53266), 53266);
  for (const bad of [0, -5, 1.5, '532', null, undefined, NaN, rules.MAX_PRICE_CENTAVOS + 1]) {
    assert.throws(() => rules.checkUnitPrice(bad), /unit price/i, String(bad));
  }
});

test('the client\'s sample PO adds up to the centavo', () => {
  const prices = [53266, 169127, 43134, 126059, 98641, 230384];
  const quantities = [11, 5, 20, 4, 30, 24];
  const lines = quantities.map((q, i) => ({ ShortQty: q, UnitPriceCentavos: prices[i] }));
  assert.deepStrictEqual(lines.map((l) => rules.lineTotal(l.ShortQty, l.UnitPriceCentavos)),
    [585926, 845635, 862680, 504236, 2959230, 5529216]);
  assert.strictEqual(rules.prTotal(lines), 11286923);
  assert.strictEqual(rules.prTotal([...lines, { ShortQty: 1, UnitPriceCentavos: null }]), null, 'no total while a line has no price');
  assert.strictEqual(rules.prTotal([]), null);
});

test('supplier form: name is required, email is checked, empty boxes become null', () => {
  const ok = rules.validateSupplierInput({ name: '  Acme  ', email: '', phone: '0917', leadTimeDays: '7' }, { creating: true });
  assert.deepStrictEqual(ok, {
    name: 'Acme', contactPerson: null, phone: '0917', email: null, address: null, paymentTerms: null, leadTimeDays: 7, isActive: true,
  });
  assert.throws(() => rules.validateSupplierInput({}, { creating: true }), /supplier name/i);
  assert.throws(() => rules.validateSupplierInput({ name: 'A', email: 'not an email' }, { creating: true }), /email/i);
  assert.throws(() => rules.validateSupplierInput({ name: 'A', leadTimeDays: -1 }, { creating: true }), /lead time/i);
  assert.throws(() => rules.validateSupplierInput({ name: 'A', leadTimeDays: 1.5 }, { creating: true }), /lead time/i);
  assert.throws(() => rules.validateSupplierInput({ name: 'x'.repeat(101) }, { creating: true }), /supplier name/i);
  assert.strictEqual(rules.validateSupplierInput({ name: 'A', isActive: false }, { creating: false }).isActive, false);
  assert.strictEqual(rules.validateSupplierInput({ name: 'A', isActive: false }, { creating: true }).isActive, true);
});

test('prices must cover every line of the PR once', () => {
  const ok = rules.validatePriceLines([{ prLineId: 1, unitPriceCentavos: 100 }, { prLineId: 2, unitPriceCentavos: 200 }], [1, 2]);
  assert.deepStrictEqual(ok, [{ prLineId: 1, unitPriceCentavos: 100 }, { prLineId: 2, unitPriceCentavos: 200 }]);
  assert.throws(() => rules.validatePriceLines([{ prLineId: 1, unitPriceCentavos: 100 }], [1, 2]), /every line/);
  assert.throws(() => rules.validatePriceLines([], [1]), /every line/);
  assert.throws(() => rules.validatePriceLines('x', [1]), /every line/);
  assert.throws(() => rules.validatePriceLines([{ prLineId: 9, unitPriceCentavos: 100 }], [1]), /does not belong/);
  assert.throws(() => rules.validatePriceLines([{ prLineId: 1, unitPriceCentavos: 100 }, { prLineId: 1, unitPriceCentavos: 100 }], [1, 2]), /twice/);
  assert.throws(() => rules.validatePriceLines([{ prLineId: 1, unitPriceCentavos: 0 }], [1]), /unit price/i);
});

test('the reason for holding or cancelling is required, trimmed and at most 300 characters', () => {
  assert.strictEqual(rules.checkReason('  Price too high  ', 'hold'), 'Price too high');
  assert.strictEqual(rules.checkReason('x'.repeat(300), 'cancel').length, 300);
  for (const bad of [undefined, null, '', '   ', 'x'.repeat(301)]) {
    assert.throws(() => rules.checkReason(bad, 'hold'), /putting it on hold/, String(bad));
    assert.throws(() => rules.checkReason(bad, 'cancel'), /cancelling it/, String(bad));
  }
});

test('the owner can approve or hold a pending PR, cancel a pending or held one, and approve only a priced one', () => {
  const decisions = rules.ownerDecisions;
  assert.deepStrictEqual(decisions('pending', true), ['approve', 'hold', 'cancel']);
  assert.deepStrictEqual(decisions('pending', false), ['hold', 'cancel']);
  assert.deepStrictEqual(decisions('on_hold', true), ['cancel']);
  assert.deepStrictEqual(decisions('on_hold', false), ['cancel']);
  assert.deepStrictEqual(decisions('approved', true), []);
  assert.deepStrictEqual(decisions('cancelled', true), []);
});

// ---------- Step 1: the handoff ----------

test('approving an RF with a shortage creates a PR for the purchaser', async () => {
  const { rf, approved, prId } = await shortagePr([['HDPE-001', 3], ['ACU-001', 2]]);

  assert.match(approved.purchaseRequisition.prNumber, /^PR-\d{4}-\d{4}$/);
  const pr = db.get('SELECT * FROM PurchaseRequisition WHERE PurchaseRequisitionId = @prId', { prId });
  assert.strictEqual(pr.PrNumber, approved.purchaseRequisition.prNumber);
  assert.strictEqual(pr.Status, 'pending');
  assert.strictEqual(pr.RequisitionId, rf.id);
  assert.strictEqual(pr.ProjectId, db.get('SELECT ProjectId FROM Requisition WHERE RequisitionId = @id', { id: rf.id }).ProjectId);

  // Only the short item is on the PR (the HDPE-001 line was fully reserved).
  const lines = db.all('SELECT ItemId, ShortQty, SupplierId, UnitPriceCentavos FROM PRLine WHERE PurchaseRequisitionId = @prId', { prId }).map((l) => ({ ...l }));
  assert.deepStrictEqual(lines, [{ ItemId: itemId('ACU-001'), ShortQty: 2, SupplierId: null, UnitPriceCentavos: null }]);

  const history = db.all(`SELECT FromStatus, ToStatus, ChangedBy FROM StatusHistory WHERE DocType = 'PR' AND DocId = @prId`, { prId }).map((h) => ({ ...h }));
  assert.deepStrictEqual(history, [{ FromStatus: null, ToStatus: 'pending', ChangedBy: user('owner1').id }]);

  const [notice] = notices('purchaser1', `${pr.PrNumber}%`);
  assert.ok(notice, 'the purchaser has a notice');
  assert.match(notice.Message, new RegExp(`${pr.PrNumber} was created from RF-\\d{4}-\\d{4}`));
  assert.strictEqual(notice.LinkUrl, `/pr.html?id=${prId}`);
});

test('an RF with enough stock makes no PR', async () => {
  const before = db.get('SELECT COUNT(*) AS n FROM PurchaseRequisition').n;
  const owner = await loginAs('owner1');
  const rf = await json(await call('POST', '/api/requisitions', await loginAs('foreman1'), rfBody([['HDPE-001', 1]])), 201);
  const approved = await json(await call('POST', `/api/requisitions/${rf.id}/approve`, owner), 200);
  assert.strictEqual(approved.purchaseRequisition, null);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM PurchaseRequisition').n, before);
});

// ---------- Who may do what ----------

test('nobody logged in gets 401 on the purchasing routes', async () => {
  for (const [m, u] of [['GET', '/api/purchasing/suppliers'], ['GET', '/api/purchasing/suppliers/1'], ['POST', '/api/purchasing/suppliers'],
    ['PUT', '/api/purchasing/suppliers/1'], ['PUT', '/api/purchasing/suppliers/1/prices/1'], ['GET', '/api/purchasing/prs'],
    ['GET', '/api/purchasing/prs/1'], ['PUT', '/api/purchasing/prs/1/prices'], ['POST', '/api/purchasing/prs/1/approve'],
    ['POST', '/api/purchasing/prs/1/hold'], ['POST', '/api/purchasing/prs/1/cancel']]) {
    assert.strictEqual((await call(m, u)).status, 401, `${m} ${u}`);
  }
});

test('suppliers and prices are for the purchaser only', async () => {
  for (const who of ['owner1', 'foreman1', 'custodian1', 'verifier1']) {
    const c = await loginAs(who);
    for (const [m, u] of [['GET', '/api/purchasing/suppliers'], ['GET', '/api/purchasing/suppliers/1'], ['POST', '/api/purchasing/suppliers'],
      ['PUT', '/api/purchasing/suppliers/1'], ['PUT', '/api/purchasing/suppliers/1/prices/1']]) {
      assert.strictEqual((await call(m, u, c, m === 'GET' ? undefined : {})).status, 403, `${who} ${m} ${u}`);
    }
  }
});

test('the purchaser and the owner read purchase requisitions, nobody else does, and only the purchaser prices', async () => {
  for (const who of ['foreman1', 'custodian1', 'verifier1']) {
    const c = await loginAs(who);
    assert.strictEqual((await call('GET', '/api/purchasing/prs', c)).status, 403, who);
    assert.strictEqual((await call('GET', '/api/purchasing/prs/1', c)).status, 403, who);
  }
  for (const who of ['owner1', 'foreman1', 'custodian1', 'verifier1']) {
    assert.strictEqual((await call('PUT', '/api/purchasing/prs/1/prices', await loginAs(who), {})).status, 403, who);
  }
  assert.strictEqual((await call('GET', '/api/purchasing/prs', await loginAs('owner1'))).status, 200);
  assert.strictEqual((await call('GET', '/api/purchasing/prs', await loginAs('purchaser1'))).status, 200);
});

// ---------- Step 2: suppliers and prices ----------

test('suppliers: the seeded one is listed with its six prices; add, reject a duplicate, edit, deactivate', async () => {
  const c = await loginAs('purchaser1');
  const list = await json(await call('GET', '/api/purchasing/suppliers', c), 200);
  const seeded = list.find((s) => s.Name === SEEDED);
  assert.strictEqual(seeded.PriceCount, 6);

  const body = { name: 'Metro Pipe Supply', contactPerson: 'Ana', phone: '0917 000 0000', email: 'ana@example.com', paymentTerms: '15 days', leadTimeDays: 5 };
  const { id } = await json(await call('POST', '/api/purchasing/suppliers', c, body), 201);
  await json(await call('POST', '/api/purchasing/suppliers', c, body), 409);
  await json(await call('POST', '/api/purchasing/suppliers', c, { ...body, name: 'METRO pipe supply' }), 409);
  await json(await call('POST', '/api/purchasing/suppliers', c, {}), 400);
  await json(await call('POST', '/api/purchasing/suppliers', c, { ...body, name: 'Other', email: 'nope' }), 400);

  await json(await call('PUT', `/api/purchasing/suppliers/${id}`, c, { ...body, leadTimeDays: 9 }), 200);
  const one = await json(await call('GET', `/api/purchasing/suppliers/${id}`, c), 200);
  assert.strictEqual(one.LeadTimeDays, 9);
  assert.strictEqual(one.IsActive, 1);
  assert.ok(one.prices.length > 0 && one.prices.every((p) => p.UnitPriceCentavos === null), 'a new supplier has no prices yet');

  // Keeping its own name on edit is fine; taking another supplier's name is not.
  await json(await call('PUT', `/api/purchasing/suppliers/${id}`, c, { ...body, name: SEEDED }), 409);
  await json(await call('PUT', `/api/purchasing/suppliers/${id}`, c, { ...body, isActive: false }), 200);
  assert.strictEqual((await json(await call('GET', `/api/purchasing/suppliers/${id}`, c), 200)).IsActive, 0);
  await json(await call('PUT', '/api/purchasing/suppliers/99999', c, body), 404);
  await json(await call('GET', '/api/purchasing/suppliers/99999', c), 404);
  await json(await call('GET', '/api/purchasing/suppliers/abc', c), 400);
});

test('a supplier price is saved, replaced and checked', async () => {
  const c = await loginAs('purchaser1');
  const sid = supplierId();
  const acu = itemId('ACU-001');
  const count = () => db.get('SELECT COUNT(*) AS n FROM SupplierPrice WHERE SupplierId = @sid AND ItemId = @acu', { sid, acu }).n;
  const priceOf = async (code) => (await json(await call('GET', `/api/purchasing/suppliers/${sid}`, c), 200)).prices.find((p) => p.Code === code).UnitPriceCentavos;

  assert.strictEqual(await priceOf('ACU-001'), null);
  await json(await call('PUT', `/api/purchasing/suppliers/${sid}/prices/${acu}`, c, { unitPriceCentavos: 123450 }), 200);
  assert.strictEqual(await priceOf('ACU-001'), 123450);
  await json(await call('PUT', `/api/purchasing/suppliers/${sid}/prices/${acu}`, c, { unitPriceCentavos: 150000 }), 200);
  assert.strictEqual(await priceOf('ACU-001'), 150000);
  assert.strictEqual(count(), 1, 'a second save replaces the price, it does not add a row');
  assert.strictEqual(await priceOf('HDPE-001'), 53266, 'the seeded prices are untouched');

  for (const bad of [0, -1, 12.5, '100', null]) {
    await json(await call('PUT', `/api/purchasing/suppliers/${sid}/prices/${acu}`, c, { unitPriceCentavos: bad }), 400);
  }
  await json(await call('PUT', `/api/purchasing/suppliers/${sid}/prices/${acu}`, c, {}), 400);
  await json(await call('PUT', `/api/purchasing/suppliers/99999/prices/${acu}`, c, { unitPriceCentavos: 100 }), 404);
  await json(await call('PUT', `/api/purchasing/suppliers/${sid}/prices/99999`, c, { unitPriceCentavos: 100 }), 404);
  await json(await call('PUT', `/api/purchasing/suppliers/${sid}/prices/abc`, c, { unitPriceCentavos: 100 }), 400);
  assert.strictEqual(await priceOf('ACU-001'), 150000, 'refused saves change nothing');
});

// ---------- Step 3: PR list, detail and pricing ----------

test('PR list and detail: the purchaser sees the RF number without opening the RF', async () => {
  const { rf, prId } = await shortagePr([['ACU-001', 2.5]]);
  const purchaser = await loginAs('purchaser1');
  const owner = await loginAs('owner1');

  assert.strictEqual((await call('GET', `/api/requisitions/${rf.id}`, purchaser)).status, 403, 'the RF routes stay closed to the purchaser');

  const list = await json(await call('GET', '/api/purchasing/prs', purchaser), 200);
  const row = list.find((p) => p.PurchaseRequisitionId === prId);
  assert.deepStrictEqual(
    [row.RfNumber, row.Status, row.LineCount, row.PricedCount, row.SupplierName, row.TotalCentavos],
    [rf.rfNumber, 'pending', 1, 0, null, null]);
  assert.ok((await json(await call('GET', '/api/purchasing/prs?status=pending', owner), 200)).some((p) => p.PurchaseRequisitionId === prId));
  assert.ok(!(await json(await call('GET', '/api/purchasing/prs?status=approved', owner), 200)).some((p) => p.PurchaseRequisitionId === prId));
  await json(await call('GET', '/api/purchasing/prs?status=bogus', owner), 400);

  const detail = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  assert.strictEqual(detail.RfNumber, rf.rfNumber);
  assert.strictEqual(detail.RequisitionId, rf.id);
  assert.deepStrictEqual([detail.lines.length, detail.lines[0].Code, detail.lines[0].ShortQty], [1, 'ACU-001', 2.5]);
  assert.strictEqual(detail.SupplierId, null);
  assert.strictEqual(detail.TotalCentavos, null);
  assert.deepStrictEqual(detail.history.map((h) => [h.FromStatus, h.ToStatus]), [[null, 'pending']]);
  assert.strictEqual(detail.canPrice, true);
  assert.strictEqual((await json(await call('GET', `/api/purchasing/prs/${prId}`, owner), 200)).canPrice, false, 'the owner reads, the purchaser prices');

  await json(await call('GET', '/api/purchasing/prs/99999', purchaser), 404);
  await json(await call('GET', '/api/purchasing/prs/abc', purchaser), 400);
});

test('saving prices: one supplier for the whole PR, a price on every line, the owner is told', async () => {
  const { prId } = await shortagePr([['ACU-001', 2.5], ['HDPE-002', 100]]); // HDPE-002 is short too: 100 asked, none on hand
  const purchaser = await loginAs('purchaser1');
  const detail = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  assert.strictEqual(detail.lines.length, 2);
  const line = (code) => detail.lines.find((l) => l.Code === code);
  const a = line('ACU-001');   // 2.5 short
  const b = line('HDPE-002');  // 100 short
  const sid = supplierId();
  const path = `/api/purchasing/prs/${prId}/prices`;
  const good = [{ prLineId: a.PrLineId, unitPriceCentavos: 12345 }, { prLineId: b.PrLineId, unitPriceCentavos: 169127 }];
  const unchanged = () => db.all('SELECT SupplierId, UnitPriceCentavos FROM PRLine WHERE PurchaseRequisitionId = @prId', { prId })
    .every((l) => l.SupplierId === null && l.UnitPriceCentavos === null);

  await json(await call('PUT', path, purchaser, { lines: good }), 400);                              // no supplier
  await json(await call('PUT', path, purchaser, { supplierId: 99999, lines: good }), 400);           // unknown supplier
  await json(await call('PUT', path, purchaser, { supplierId: sid, lines: [good[0]] }), 400);        // a line is missing
  await json(await call('PUT', path, purchaser, { supplierId: sid, lines: [good[0], { prLineId: 999999, unitPriceCentavos: 5 }] }), 400);
  await json(await call('PUT', path, purchaser, { supplierId: sid, lines: [good[0], { ...good[1], unitPriceCentavos: 0 }] }), 400);
  assert.ok(unchanged(), 'refused saves change nothing');

  const inactive = await json(await call('POST', '/api/purchasing/suppliers', purchaser, { name: 'Closed Supplier' }), 201);
  await json(await call('PUT', `/api/purchasing/suppliers/${inactive.id}`, purchaser, { name: 'Closed Supplier', isActive: false }), 200);
  await json(await call('PUT', path, purchaser, { supplierId: inactive.id, lines: good }), 400);
  assert.ok(unchanged());

  const before = notices('owner1', '%has a supplier and prices%').length;
  const saved = await json(await call('PUT', path, purchaser, { supplierId: sid, lines: good }), 200);
  assert.deepStrictEqual(saved, { id: prId, status: 'pending' });

  const after = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  assert.strictEqual(after.Status, 'pending');
  assert.deepStrictEqual([after.SupplierId, after.SupplierName], [sid, SEEDED]);
  const priced = (code) => after.lines.find((l) => l.Code === code);
  assert.deepStrictEqual([priced('ACU-001').UnitPriceCentavos, priced('ACU-001').LineTotalCentavos], [12345, 30863], '2.5 x 123.45 = 308.625, rounded to 308.63');
  assert.deepStrictEqual([priced('HDPE-002').UnitPriceCentavos, priced('HDPE-002').LineTotalCentavos], [169127, 16912700]);
  assert.strictEqual(after.TotalCentavos, 30863 + 16912700);
  assert.strictEqual(after.history.length, 1, 'a save on a pending PR is not a status change');

  // The list shows the same total as the detail, worked out in SQL instead of JS.
  const row = (await json(await call('GET', '/api/purchasing/prs', purchaser), 200)).find((p) => p.PurchaseRequisitionId === prId);
  assert.deepStrictEqual([row.PricedCount, row.LineCount, row.SupplierName, row.TotalCentavos], [2, 2, SEEDED, after.TotalCentavos]);

  const told = notices('owner1', '%has a supplier and prices%');
  assert.strictEqual(told.length, before + 1);
  assert.match(told.at(-1).Message, new RegExp(`${after.PrNumber} has a supplier and prices`));
  assert.strictEqual(told.at(-1).LinkUrl, `/pr.html?id=${prId}`);

  // Changing the prices again, before the owner decides, is fine.
  await json(await call('PUT', path, purchaser, { supplierId: sid, lines: [{ ...good[0], unitPriceCentavos: 20000 }, good[1]] }), 200);
  assert.strictEqual((await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200)).lines.find((l) => l.Code === 'ACU-001').UnitPriceCentavos, 20000);
});

test('a held PR goes back to pending when the purchaser revises it; a decided PR cannot be priced', async () => {
  const { prId } = await shortagePr([['ACU-001', 1]]);
  const purchaser = await loginAs('purchaser1');
  const detail = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  const body = { supplierId: supplierId(), lines: [{ prLineId: detail.lines[0].PrLineId, unitPriceCentavos: 99900 }] };
  const path = `/api/purchasing/prs/${prId}/prices`;

  await json(await decide(await loginAs('owner1'), prId, 'hold', 'Price too high'), 200);
  const held = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  assert.deepStrictEqual([held.Status, held.Reason, held.canPrice], ['on_hold', 'Price too high', true]);

  const before = notices('owner1', '%was revised%').length;
  await json(await call('PUT', path, purchaser, body), 200);
  const revised = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  assert.deepStrictEqual([revised.Status, revised.Reason, revised.DecidedByName], ['pending', null, null]);
  assert.deepStrictEqual(revised.history.map((h) => [h.FromStatus, h.ToStatus, h.Reason]),
    [[null, 'pending', null], ['pending', 'on_hold', 'Price too high'], ['on_hold', 'pending', 'Revised and resubmitted']]);
  assert.strictEqual(notices('owner1', '%was revised%').length, before + 1);

  for (const status of ['approved', 'cancelled']) {
    db.run(`UPDATE PurchaseRequisition SET Status = @status, Reason = 'x' WHERE PurchaseRequisitionId = @prId`, { status, prId });
    const res = await call('PUT', path, purchaser, body);
    assert.strictEqual(res.status, 409, status);
    assert.match((await res.json()).error, new RegExp(status));
    assert.strictEqual((await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200)).canPrice, false, status);
  }
  await json(await call('PUT', '/api/purchasing/prs/99999/prices', purchaser, body), 404);
  await json(await call('PUT', '/api/purchasing/prs/abc/prices', purchaser, body), 400);
});

// ---------- Step 4: the owner's decision ----------

test('only the owner can approve, hold or cancel a PR', async () => {
  for (const action of ['approve', 'hold', 'cancel']) {
    assert.strictEqual((await call('POST', `/api/purchasing/prs/1/${action}`)).status, 401, action);
    for (const who of ['purchaser1', 'foreman1', 'custodian1', 'verifier1']) {
      assert.strictEqual((await decide(await loginAs(who), 1, action, 'x')).status, 403, `${who} ${action}`);
    }
  }
});

test('a PR that does not exist is a 404, a broken id is a 400, and the reason is checked first', async () => {
  const owner = await loginAs('owner1');
  assert.strictEqual((await decide(owner, 99999, 'approve')).status, 404);
  assert.strictEqual((await decide(owner, 99999, 'hold', 'x')).status, 404);
  assert.strictEqual((await decide(owner, 99999, 'cancel', 'x')).status, 404);
  assert.strictEqual((await decide(owner, 99999, 'hold')).status, 400, 'no reason');
  assert.strictEqual((await call('POST', '/api/purchasing/prs/abc/approve', owner, {})).status, 400);
});

test('approve: refused until every line is priced; then the PR is approved, logged, and the right people are told', async () => {
  const { rf, prId } = await shortagePr([['ACU-001', 2]]);
  const owner = await loginAs('owner1');
  const purchaser = await loginAs('purchaser1');
  const path = `/api/purchasing/prs/${prId}`;
  const prNumber = prNumberOf(prId);
  const rfNumber = rfNumberOf(rf.id);

  // Nothing is priced yet: the owner may hold or cancel, not approve.
  assert.deepStrictEqual((await json(await call('GET', path, owner), 200)).decisions, ['hold', 'cancel']);
  const early = await decide(owner, prId, 'approve');
  assert.strictEqual(early.status, 409);
  assert.match((await early.json()).error, /supplier and a price/);
  assert.deepStrictEqual(prRow(prId), { Status: 'pending', Reason: null, DecidedBy: null });
  assert.strictEqual(historyOf(prId).length, 1, 'a refused approval writes nothing');

  await priceIt(prId, purchaser);
  assert.deepStrictEqual((await json(await call('GET', path, owner), 200)).decisions, ['approve', 'hold', 'cancel']);
  assert.deepStrictEqual((await json(await call('GET', path, purchaser), 200)).decisions, [], 'the purchaser gets no decision buttons');

  assert.deepStrictEqual(await json(await decide(owner, prId, 'approve'), 200), { id: prId, status: 'approved' });

  const after = await json(await call('GET', path, owner), 200);
  const ownerName = db.get(`SELECT FullName FROM AppUser WHERE Username = 'owner1'`).FullName;
  assert.deepStrictEqual([after.Status, after.Reason, after.DecidedByName, after.decisions], ['approved', null, ownerName, []]);
  assert.strictEqual(prRow(prId).DecidedBy, user('owner1').id);
  assert.deepStrictEqual(historyOf(prId), [
    { FromStatus: null, ToStatus: 'pending', Reason: null },
    { FromStatus: 'pending', ToStatus: 'approved', Reason: null },
  ]);

  // The purchaser is told on the PR page. The foreman is told on the RF page (he cannot open the PR page), with no money in it.
  const toPurchaser = notices('purchaser1', `${prNumber} was approved%`);
  assert.deepStrictEqual(toPurchaser.map((n) => ({ ...n })), [{ Message: `${prNumber} was approved.`, LinkUrl: `/pr.html?id=${prId}` }]);
  const toForeman = notices('foreman1', `${prNumber} for%`);
  assert.deepStrictEqual(toForeman.map((n) => ({ ...n })), [{ Message: `${prNumber} for ${rfNumber} was approved.`, LinkUrl: `/requisition.html?id=${rf.id}` }]);
  assert.strictEqual(notices('owner1', `${prNumber} was%`).length, 0, 'the owner is not told about his own decision');

  // A decided PR cannot be decided again, and the purchaser can no longer change the prices.
  for (const action of ['approve', 'hold', 'cancel']) {
    const res = await decide(owner, prId, action, 'Changed my mind');
    assert.strictEqual(res.status, 409, action);
    assert.match((await res.json()).error, /is approved/, action);
  }
  const body = { supplierId: supplierId(), lines: [{ prLineId: after.lines[0].PrLineId, unitPriceCentavos: 1 }] };
  await json(await call('PUT', `${path}/prices`, purchaser, body), 409);
  assert.strictEqual(prRow(prId).Status, 'approved');
  assert.strictEqual(historyOf(prId).length, 2, 'the refused decisions wrote nothing');
});

test('hold: needs a reason, the purchaser hears it and the foreman does not, and a revised PR can then be approved', async () => {
  const { rf, prId } = await shortagePr([['ACU-001', 1]]);
  const owner = await loginAs('owner1');
  const purchaser = await loginAs('purchaser1');
  const path = `/api/purchasing/prs/${prId}`;
  const prNumber = prNumberOf(prId);
  const rfNumber = rfNumberOf(rf.id);
  const told = () => notices('purchaser1', `${prNumber}%`).length + notices('foreman1', `${prNumber}%`).length;

  // No reason, or a bad one: nothing changes and nobody is told.
  const toldBefore = told();
  for (const bad of [undefined, '', '   ', 'x'.repeat(301)]) {
    const res = await decide(owner, prId, 'hold', bad);
    assert.strictEqual(res.status, 400, String(bad).slice(0, 10));
    assert.match((await res.json()).error, /reason/i);
  }
  assert.deepStrictEqual(prRow(prId), { Status: 'pending', Reason: null, DecidedBy: null });
  assert.strictEqual(told(), toldBefore);

  // Holding works on a PR that is not priced yet.
  assert.deepStrictEqual(await json(await decide(owner, prId, 'hold', '  Wait for a second quote  '), 200), { id: prId, status: 'on_hold' });
  const held = await json(await call('GET', path, owner), 200);
  assert.deepStrictEqual([held.Status, held.Reason, held.decisions], ['on_hold', 'Wait for a second quote', ['cancel']]);
  assert.strictEqual((await json(await call('GET', path, purchaser), 200)).canPrice, true, 'the purchaser can revise a held PR');

  assert.deepStrictEqual(notices('purchaser1', `${prNumber} was put on hold%`).map((n) => ({ ...n })),
    [{ Message: `${prNumber} was put on hold: Wait for a second quote`, LinkUrl: `/pr.html?id=${prId}` }]);
  const toForeman = notices('foreman1', `${prNumber} for%`);
  assert.deepStrictEqual(toForeman.map((n) => ({ ...n })), [{ Message: `${prNumber} for ${rfNumber} was put on hold.`, LinkUrl: `/requisition.html?id=${rf.id}` }]);
  assert.ok(!toForeman[0].Message.includes('second quote'), 'the reason stays between the owner and the purchaser');

  // A held PR cannot be held or approved again, and cannot be approved while it is held.
  for (const action of ['hold', 'approve']) {
    const res = await decide(owner, prId, action, 'again');
    assert.strictEqual(res.status, 409, action);
    assert.match((await res.json()).error, /is on hold/, action);
  }

  // The purchaser revises it, it goes back to pending, and the owner approves it.
  await priceIt(prId, purchaser);
  const revised = await json(await call('GET', path, owner), 200);
  assert.deepStrictEqual([revised.Status, revised.Reason, revised.DecidedByName, revised.decisions], ['pending', null, null, ['approve', 'hold', 'cancel']]);
  await json(await decide(owner, prId, 'approve'), 200);
  assert.deepStrictEqual(historyOf(prId), [
    { FromStatus: null, ToStatus: 'pending', Reason: null },
    { FromStatus: 'pending', ToStatus: 'on_hold', Reason: 'Wait for a second quote' },
    { FromStatus: 'on_hold', ToStatus: 'pending', Reason: 'Revised and resubmitted' },
    { FromStatus: 'pending', ToStatus: 'approved', Reason: null },
  ]);
});

test('cancel: needs a reason, works on a pending or a held PR, refuses a decided one, and leaves the RF alone', async () => {
  const owner = await loginAs('owner1');
  const purchaser = await loginAs('purchaser1');
  const foreman = await loginAs('foreman1');

  // A pending PR.
  const a = await shortagePr([['ACU-001', 1]]);
  const prNumber = prNumberOf(a.prId);
  const rfNumber = rfNumberOf(a.rf.id);
  const rfState = () => ({
    rf: { ...db.get('SELECT Status FROM Requisition WHERE RequisitionId = @id', { id: a.rf.id }) },
    lines: db.all('SELECT ItemId, Quantity, QtyReserved FROM RequisitionLine WHERE RequisitionId = @id', { id: a.rf.id }).map((l) => ({ ...l })),
  });
  const rfBefore = rfState();

  assert.strictEqual((await decide(owner, a.prId, 'cancel')).status, 400, 'no reason');
  assert.strictEqual(prRow(a.prId).Status, 'pending');
  assert.deepStrictEqual(await json(await decide(owner, a.prId, 'cancel', 'Not needed any more'), 200), { id: a.prId, status: 'cancelled' });

  const cancelled = await json(await call('GET', `/api/purchasing/prs/${a.prId}`, owner), 200);
  assert.deepStrictEqual([cancelled.Status, cancelled.Reason, cancelled.decisions], ['cancelled', 'Not needed any more', []]);
  assert.deepStrictEqual(historyOf(a.prId), [
    { FromStatus: null, ToStatus: 'pending', Reason: null },
    { FromStatus: 'pending', ToStatus: 'cancelled', Reason: 'Not needed any more' },
  ]);
  assert.deepStrictEqual(notices('purchaser1', `${prNumber} was cancelled%`).map((n) => n.Message), [`${prNumber} was cancelled: Not needed any more`]);
  assert.deepStrictEqual(notices('foreman1', `${prNumber} for%`).map((n) => n.Message), [`${prNumber} for ${rfNumber} was cancelled.`]);

  for (const action of ['approve', 'hold', 'cancel']) {
    const res = await decide(owner, a.prId, action, 'x');
    assert.strictEqual(res.status, 409, action);
    assert.match((await res.json()).error, /is cancelled/, action);
  }
  const body = { supplierId: supplierId(), lines: [{ prLineId: cancelled.lines[0].PrLineId, unitPriceCentavos: 5 }] };
  await json(await call('PUT', `/api/purchasing/prs/${a.prId}/prices`, purchaser, body), 409);
  assert.strictEqual((await json(await call('GET', `/api/purchasing/prs/${a.prId}`, purchaser), 200)).canPrice, false);

  // The RF is untouched: same status, same lines, and the Document Trail shows the PR as cancelled (number and status only).
  assert.deepStrictEqual(rfState(), rfBefore);
  const trail = await json(await call('GET', `/api/requisitions/${a.rf.id}`, foreman), 200);
  assert.deepStrictEqual(trail.purchaseRequisitions, [{ PrNumber: prNumber, Status: 'cancelled' }]);

  // A held PR can be cancelled too. Its first reason stays in the history.
  const b = await shortagePr([['ACU-001', 1]]);
  await json(await decide(owner, b.prId, 'hold', 'Wait for the next quote'), 200);
  await json(await decide(owner, b.prId, 'cancel', 'The quote came back too high'), 200);
  const heldThenCancelled = await json(await call('GET', `/api/purchasing/prs/${b.prId}`, owner), 200);
  assert.deepStrictEqual([heldThenCancelled.Status, heldThenCancelled.Reason], ['cancelled', 'The quote came back too high']);
  assert.deepStrictEqual(historyOf(b.prId), [
    { FromStatus: null, ToStatus: 'pending', Reason: null },
    { FromStatus: 'pending', ToStatus: 'on_hold', Reason: 'Wait for the next quote' },
    { FromStatus: 'on_hold', ToStatus: 'cancelled', Reason: 'The quote came back too high' },
  ]);

  // An approved PR cannot be cancelled.
  const c = await shortagePr([['ACU-001', 1]]);
  await priceIt(c.prId, purchaser);
  await json(await decide(owner, c.prId, 'approve'), 200);
  assert.strictEqual((await decide(owner, c.prId, 'cancel', 'x')).status, 409);
  assert.strictEqual(prRow(c.prId).Status, 'approved');
});
