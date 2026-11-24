// Cancelling an RF: the foreman while pending or returned, the owner after approval; each test uses its own item.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, start, stop, loginAs, call, rfBody, user, item, itemId } = require('./helpers');
const slips = require('../server/services/issuance');
const receipts = require('../server/services/receipts');
const { createPurchaseRequisition } = require('../server/services/handoff');

test.before(async () => {
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role) VALUES ('Other Foreman', 'foreman2', @hash, 'foreman')`,
    { hash: bcrypt.hashSync('secret123', 4) });
  await start();
});
test.after(stop);

const json = async (res, status) => { assert.strictEqual(res.status, status, await res.clone().text()); return res.json(); };
const errorOf = async (res, status) => (await json(res, status)).error;

const setStock = (code, onHand) => db.run('UPDATE Item SET OnHand = @onHand, Reserved = 0 WHERE Code = @code', { onHand, code });
const row = (id) => ({ ...db.get('SELECT Status FROM Requisition WHERE RequisitionId = @id', { id }) });
const lines = (id) => db.all('SELECT ItemId, QtyReserved, QtyShort, QtyIssued FROM RequisitionLine WHERE RequisitionId = @id ORDER BY LineId', { id }).map((l) => ({ ...l }));
const history = (id) => db.all(`SELECT FromStatus, ToStatus, Reason FROM StatusHistory WHERE DocType = 'RF' AND DocId = @id ORDER BY HistoryId`, { id }).map((h) => ({ ...h }));
const lastNote = (username) => ({ ...db.get('SELECT Message, LinkUrl FROM Notification WHERE UserId = @id ORDER BY NotificationId DESC LIMIT 1', { id: user(username).id }) });
const noteCount = (username) => db.get('SELECT COUNT(*) AS n FROM Notification WHERE UserId = @id', { id: user(username).id }).n;
const stockLog = () => db.get('SELECT COUNT(*) AS n FROM StockTransaction').n;
const prsOf = (id) => db.all('SELECT PrNumber, Status, Reason, OverBudget FROM PurchaseRequisition WHERE RequisitionId = @id', { id }).map((p) => ({ ...p }));
const prLines = (id) => db.all(`SELECT l.ItemId, l.ShortQty FROM PRLine l JOIN PurchaseRequisition p ON p.PurchaseRequisitionId = l.PurchaseRequisitionId WHERE p.RequisitionId = @id`, { id }).map((l) => ({ ...l }));

async function fileRf(cookie, rows) {
  return json(await call('POST', '/api/requisitions', cookie, rfBody(rows)), 201);
}
async function approvedRf(foreman, owner, rows) {
  const { id, rfNumber } = await fileRf(foreman, rows);
  await json(await call('POST', `/api/requisitions/${id}/approve`, owner), 200);
  return { id, rfNumber };
}
const ownerCancel = (cookie, id, reason) => call('POST', `/api/requisitions/${id}/cancel-approved`, cookie, reason === undefined ? {} : { reason });

test('the foreman cancels his own pending requisition: it stays on file, the owner is told, nothing is reserved', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  setStock('ACU-001', 0);
  const logBefore = stockLog();
  const { id, rfNumber } = await fileRf(foreman, [['ACU-001', 1]]);

  const out = await json(await call('POST', `/api/requisitions/${id}/cancel`, foreman, {}), 200);
  assert.deepStrictEqual(out, { id, status: 'cancelled' });
  assert.strictEqual(row(id).Status, 'cancelled');
  assert.deepStrictEqual(history(id), [
    { FromStatus: null, ToStatus: 'pending', Reason: null },
    { FromStatus: 'pending', ToStatus: 'cancelled', Reason: 'Cancelled by the requestor' },
  ]);
  assert.deepStrictEqual(lastNote('owner1'), { Message: `${rfNumber} was cancelled by Test Foreman before you decided on it.`, LinkUrl: `/requisition.html?id=${id}` });
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 0, Reserved: 0 });
  assert.deepStrictEqual(prsOf(id), []);
  assert.strictEqual(stockLog(), logBefore);

  // Nobody can act on it any more.
  assert.match(await errorOf(await call('POST', `/api/requisitions/${id}/approve`, owner), 409), /cancelled/);
  assert.match(await errorOf(await call('POST', `/api/requisitions/${id}/return`, owner, { reason: 'x' }), 409), /cancelled/);
  await json(await call('PUT', `/api/requisitions/${id}`, foreman, rfBody([['ACU-001', 2]])), 409);
  await json(await call('POST', `/api/requisitions/${id}/cancel`, foreman, {}), 409);
  await json(await call('POST', `/api/requisitions/${id}/cancel-approved`, owner, { reason: 'x' }), 409);
  assert.strictEqual(row(id).Status, 'cancelled');
});

test('a foreman cancel can carry a reason (trimmed, 300 characters at most); a returned one still says "Not revised"', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const first = await fileRf(foreman, [['ACU-001', 1]]);
  await json(await call('POST', `/api/requisitions/${first.id}/cancel`, foreman, { reason: '  the client changed the plan  ' }), 200);
  assert.strictEqual(history(first.id).at(-1).Reason, 'the client changed the plan');

  const long = await fileRf(foreman, [['ACU-001', 1]]);
  await json(await call('POST', `/api/requisitions/${long.id}/cancel`, foreman, { reason: 'x'.repeat(400) }), 200);
  assert.strictEqual(history(long.id).at(-1).Reason.length, 300);

  const returned = await fileRf(foreman, [['ACU-001', 1]]);
  await json(await call('POST', `/api/requisitions/${returned.id}/return`, owner, { reason: 'Add the size' }), 200);
  const before = noteCount('owner1');
  await json(await call('POST', `/api/requisitions/${returned.id}/cancel`, foreman, {}), 200);
  assert.deepStrictEqual(history(returned.id).at(-1), { FromStatus: 'returned', ToStatus: 'cancelled', Reason: 'Not revised' });
  assert.strictEqual(noteCount('owner1'), before, 'cancelling a returned RF does not notify the owner, who returned it');
});

test('who may use the foreman cancel: only the requestor, only while pending or returned', async () => {
  const one = await loginAs('foreman1');
  const two = await loginAs('foreman2');
  const owner = await loginAs('owner1');
  const { id } = await fileRf(one, [['ACU-001', 1]]);

  await json(await call('POST', `/api/requisitions/${id}/cancel`, two, {}), 403);
  await json(await call('POST', `/api/requisitions/${id}/cancel`, owner, {}), 403);
  await json(await call('POST', `/api/requisitions/${id}/cancel`, undefined, {}), 401);
  await json(await call('POST', '/api/requisitions/999999/cancel', one, {}), 404);
  assert.strictEqual(row(id).Status, 'pending', 'every refused try left it pending');

  // Once approved, the foreman can no longer cancel it. Only the owner can.
  setStock('HDPE-002', 4);
  const approved = await approvedRf(one, owner, [['HDPE-002', 2]]);
  assert.match(await errorOf(await call('POST', `/api/requisitions/${approved.id}/cancel`, one, {}), 409), /approved.*pending or returned/);
  assert.strictEqual(row(approved.id).Status, 'approved');
  assert.deepStrictEqual(item('HDPE-002'), { OnHand: 4, Reserved: 2 });
});

test('the owner cancels an approved requisition: reserved stock is free again, and can be reserved by the next one', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const custodian = await loginAs('custodian1');
  setStock('HDPE-001', 10);
  const logBefore = stockLog();
  const { id, rfNumber } = await approvedRf(foreman, owner, [['HDPE-001', 6]]);
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 6 });

  const purchaserBefore = noteCount('purchaser1');
  const out = await json(await ownerCancel(owner, id, '  Client moved the job  '), 200);
  assert.deepStrictEqual(out, { id, status: 'cancelled', releasedLines: 1 });
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 0 });
  assert.deepStrictEqual(lines(id), [{ ItemId: itemId('HDPE-001'), QtyReserved: 0, QtyShort: 0, QtyIssued: 0 }]);
  assert.strictEqual(row(id).Status, 'cancelled');
  assert.deepStrictEqual(history(id).slice(-2), [
    { FromStatus: 'pending', ToStatus: 'approved', Reason: null },
    { FromStatus: 'approved', ToStatus: 'cancelled', Reason: 'Client moved the job' },
  ]);
  assert.strictEqual(stockLog(), logBefore, 'a reservation is not a stock movement, so nothing is logged');

  assert.deepStrictEqual(lastNote('foreman1'), { Message: `${rfNumber} was cancelled by the owner: Client moved the job`, LinkUrl: `/requisition.html?id=${id}` });
  assert.deepStrictEqual(lastNote('custodian1'), { Message: `${rfNumber} was cancelled. Its reserved items are free again.`, LinkUrl: '/slips.html' });
  assert.strictEqual(noteCount('purchaser1'), purchaserBefore, 'no purchase requisition exists, so the purchaser is not told');

  // The RF no longer shows up for the warehouse, and cannot get a slip.
  assert.ok(!slips.listReleasable().some((r) => r.RequisitionId === id));
  assert.match(await errorOf(await call('POST', '/api/slips', custodian, { requisitionId: id }), 409), /approved requisition/);

  const page = await json(await call('GET', `/api/requisitions/${id}`, foreman), 200);
  assert.strictEqual(page.Status, 'cancelled');
  assert.deepStrictEqual(page.lines.map((l) => [l.QtyReserved, l.QtyShort]), [[0, 0]]);

  // The released units can go straight to another requisition.
  const next = await approvedRf(foreman, owner, [['HDPE-001', 10]]);
  assert.deepStrictEqual(lines(next.id).map((l) => [l.QtyReserved, l.QtyShort]), [[10, 0]]);
  assert.deepStrictEqual(prsOf(next.id), [], 'all 10 were available, so no purchase requisition');
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 10 });
});

test('a requisition with a shortage: the reserved part is released, the purchase requisition is left alone, goods that arrive stay free', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  setStock('HDPE-003', 4);
  const { id, rfNumber } = await approvedRf(foreman, owner, [['HDPE-003', 6]]);
  assert.deepStrictEqual(lines(id).map((l) => [l.QtyReserved, l.QtyShort]), [[4, 2]]);
  const prBefore = prsOf(id);
  const prLinesBefore = prLines(id);
  assert.strictEqual(prBefore.length, 1);
  assert.deepStrictEqual(prLinesBefore, [{ ItemId: itemId('HDPE-003'), ShortQty: 2 }]);

  // The PR shows its RF's status to both the purchaser and the owner.
  const purchaser = await loginAs('purchaser1');
  const prId = db.get('SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE RequisitionId = @id', { id }).id;
  const seen = async (cookie) => ({
    list: (await json(await call('GET', '/api/purchasing/prs', cookie), 200)).find((p) => p.PurchaseRequisitionId === prId).RfStatus,
    page: (await json(await call('GET', `/api/purchasing/prs/${prId}`, cookie), 200)).RfStatus,
  });
  assert.deepStrictEqual(await seen(purchaser), { list: 'approved', page: 'approved' });

  await json(await ownerCancel(owner, id, 'Not needed any more'), 200);
  assert.deepStrictEqual(await seen(purchaser), { list: 'cancelled', page: 'cancelled' });
  assert.deepStrictEqual(await seen(owner), { list: 'cancelled', page: 'cancelled' });
  assert.deepStrictEqual(item('HDPE-003'), { OnHand: 4, Reserved: 0 });
  assert.deepStrictEqual(lines(id).map((l) => [l.QtyReserved, l.QtyShort]), [[0, 0]]);
  assert.deepStrictEqual(prsOf(id), prBefore, 'the purchase requisition is exactly as it was');
  assert.deepStrictEqual(prLines(id), prLinesBefore);
  assert.deepStrictEqual(lastNote('purchaser1'), { Message: `${rfNumber} was cancelled. ${prBefore[0].PrNumber} was made for it and has not been changed.`, LinkUrl: '/prs.html' });

  // Delivered pieces go on the shelf, not aside for the cancelled RF.
  const delivered = db.transaction(() => {
    receipts.receiveStock({ itemId: itemId('HDPE-003'), quantity: 2, sourceDocument: { type: 'RR', id: 1, number: 'RR-TEST' }, userId: user('purchaser1').id });
    return receipts.allocateToRequisition({ requisitionId: id, lines: [{ itemId: itemId('HDPE-003'), quantity: 2 }], userId: user('purchaser1').id });
  });
  assert.deepStrictEqual(delivered, { allocated: [], slip: null });
  assert.deepStrictEqual(item('HDPE-003'), { OnHand: 6, Reserved: 0 });
});

test('other requisitions hold part of the same stock: a cancel frees only its own part, and a short requisition takes only what is free', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  setStock('ACU-001', 7);
  const held = await approvedRf(foreman, owner, [['ACU-001', 4]]);
  const cancelled = await approvedRf(foreman, owner, [['ACU-001', 3]]);
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 7, Reserved: 7 }, 'nothing is free any more');

  await json(await ownerCancel(owner, cancelled.id, 'First cancel'), 200);
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 7, Reserved: 4 }, 'only the 3 of the cancelled one came back');
  assert.deepStrictEqual(lines(held.id).map((l) => l.QtyReserved), [4]);
  assert.strictEqual(row(held.id).Status, 'approved');

  // A request for 14 takes the 3 free pieces and waits for 11 through a PR.
  const big = await approvedRf(foreman, owner, [['ACU-001', 14]]);
  assert.deepStrictEqual(lines(big.id).map((l) => [l.QtyReserved, l.QtyShort]), [[3, 11]]);
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 7, Reserved: 7 }, 'the 3 freed pieces were taken again');
  const prBefore = prsOf(big.id);
  assert.strictEqual(prBefore.length, 1);

  await json(await ownerCancel(owner, big.id, 'Second cancel'), 200);
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 7, Reserved: 4 }, 'back to what the first requisition holds');
  assert.deepStrictEqual(prsOf(big.id), prBefore);
  assert.deepStrictEqual(lines(held.id).map((l) => l.QtyReserved), [4]);
});

test('a purchase requisition made without a requisition form has no requisition status', async () => {
  const purchaser = await loginAs('purchaser1');
  const owner = user('owner1');
  const { prNumber, id } = db.transaction(() => createPurchaseRequisition({
    requisitionId: null, rfNumber: 'RF-CLIENT', projectId: db.get('SELECT ProjectId FROM Project LIMIT 1').ProjectId, userId: owner.id,
    lines: [{ itemId: itemId('HDPE-001'), shortQty: 2 }],
  }));
  const prId = id || db.get('SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE PrNumber = @prNumber', { prNumber }).id;
  assert.strictEqual((await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200)).RfStatus, null);
  assert.strictEqual((await json(await call('GET', '/api/purchasing/prs', purchaser), 200)).find((p) => p.PurchaseRequisitionId === prId).RfStatus, null);
});

test('a prepared slip is cancelled with the requisition; releasing it afterwards is refused', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const custodian = user('custodian1');
  setStock('HDPE-004', 5);
  const { id, rfNumber } = await approvedRf(foreman, owner, [['HDPE-004', 3]]);
  const { id: slipId, slipNumber } = slips.prepareSlip(custodian, id);

  await json(await ownerCancel(owner, id, 'Wrong project'), 200);
  assert.deepStrictEqual(item('HDPE-004'), { OnHand: 5, Reserved: 0 });
  const slip = slips.getSlip(custodian, slipId);
  assert.strictEqual(slip.Status, 'cancelled');
  assert.deepStrictEqual(slip.history.map((h) => [h.FromStatus, h.ToStatus, h.Reason]), [[null, 'prepared', null], ['prepared', 'cancelled', `${rfNumber} was cancelled`]]);
  assert.throws(() => slips.releaseSlip(custodian, slipId), (e) => e.status === 409);
  assert.strictEqual(lastNote('custodian1').Message, `${rfNumber} was cancelled. Its reserved items are free again, and ${slipNumber} was cancelled.`);
  const page = await json(await call('GET', `/api/requisitions/${id}`, await loginAs('foreman1')), 200);
  assert.deepStrictEqual(page.slips.map((s) => s.Status), ['cancelled']);
});

test('a slip already released to the foreman blocks the cancel; after he confirms, the items are issued and it cannot be cancelled either', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const custodian = user('custodian1');
  setStock('HDPE-005', 5);
  const { id, rfNumber } = await approvedRf(foreman, owner, [['HDPE-005', 2]]);
  const { id: slipId, slipNumber } = slips.prepareSlip(custodian, id);
  slips.releaseSlip(custodian, slipId);
  const logBefore = stockLog();

  assert.strictEqual(await errorOf(await ownerCancel(owner, id, 'Changed my mind'), 409), `${slipNumber} was already released to the requestor, so ${rfNumber} cannot be cancelled now.`);
  assert.strictEqual(row(id).Status, 'approved');
  assert.deepStrictEqual(item('HDPE-005'), { OnHand: 5, Reserved: 2 });
  assert.strictEqual(slips.getSlip(custodian, slipId).Status, 'released');
  assert.strictEqual(history(id).at(-1).ToStatus, 'approved');

  slips.acknowledgeSlip(user('foreman1'), slipId);
  assert.strictEqual(row(id).Status, 'fulfilled');
  assert.deepStrictEqual(item('HDPE-005'), { OnHand: 3, Reserved: 0 });
  assert.strictEqual(await errorOf(await ownerCancel(owner, id, 'Too late'), 409), `Items were already issued on ${rfNumber}, so it cannot be cancelled.`);
  assert.deepStrictEqual(item('HDPE-005'), { OnHand: 3, Reserved: 0 });
  assert.strictEqual(stockLog(), logBefore + 1, 'only the issue was logged');
});

test('a partly fulfilled requisition cannot be cancelled, and nothing changes', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const custodian = user('custodian1');
  setStock('HDPE-006', 3);
  const { id, rfNumber } = await approvedRf(foreman, owner, [['HDPE-006', 5]]); // 3 reserved, 2 short, a PR
  const { id: slipId } = slips.prepareSlip(custodian, id);
  slips.releaseSlip(custodian, slipId);
  slips.acknowledgeSlip(user('foreman1'), slipId);
  assert.strictEqual(row(id).Status, 'partly_fulfilled');
  const prBefore = prsOf(id);
  const linesBefore = lines(id);

  assert.strictEqual(await errorOf(await ownerCancel(owner, id, 'Stop the rest'), 409), `Items were already issued on ${rfNumber}, so it cannot be cancelled.`);
  assert.strictEqual(row(id).Status, 'partly_fulfilled');
  assert.deepStrictEqual(lines(id), linesBefore);
  assert.deepStrictEqual(prsOf(id), prBefore);
  assert.deepStrictEqual(item('HDPE-006'), { OnHand: 0, Reserved: 0 });
});

test('the owner cancel: reason needed, wrong states refused, owner only; every refusal changes nothing', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  setStock('HDPE-002', 10);
  const { id } = await approvedRf(foreman, owner, [['HDPE-002', 4]]);
  const snapshot = () => JSON.stringify([row(id), lines(id), history(id), { ...item('HDPE-002') }, noteCount('foreman1')]);
  const before = snapshot();

  // A reason is needed: none, blank, or over 300 characters.
  for (const reason of [undefined, '', '   ', 'x'.repeat(301)]) {
    assert.match(await errorOf(await ownerCancel(owner, id, reason), 400), /reason for cancelling/, JSON.stringify(reason));
  }
  // Everyone but the owner.
  for (const who of ['foreman1', 'custodian1', 'purchaser1', 'verifier1']) {
    await json(await ownerCancel(await loginAs(who), id, 'Test reason'), 403);
  }
  await json(await ownerCancel(undefined, id, 'Test reason'), 401);
  await json(await ownerCancel(owner, 999999, 'Test reason'), 404);
  await json(await ownerCancel(owner, 'abc', 'Test reason'), 400);
  assert.strictEqual(snapshot(), before);

  // Pending and returned RFs are not for this route; the owner returns those.
  const pending = await fileRf(foreman, [['ACU-001', 1]]);
  assert.match(await errorOf(await ownerCancel(owner, pending.id, 'Test reason'), 409), /pending.*must be approved/);
  const returned = await fileRf(foreman, [['ACU-001', 1]]);
  await json(await call('POST', `/api/requisitions/${returned.id}/return`, owner, { reason: 'Add the size' }), 200);
  assert.match(await errorOf(await ownerCancel(owner, returned.id, 'Test reason'), 409), /returned.*must be approved/);
  assert.strictEqual(row(pending.id).Status, 'pending');
  assert.strictEqual(row(returned.id).Status, 'returned');

  // Done once, and the second try is refused.
  await json(await ownerCancel(owner, id, 'First'), 200);
  assert.match(await errorOf(await ownerCancel(owner, id, 'Second'), 409), /cancelled.*must be approved/);
  assert.deepStrictEqual(item('HDPE-002'), { OnHand: 10, Reserved: 0 });
  assert.deepStrictEqual(history(id).filter((h) => h.ToStatus === 'cancelled').length, 1);
});

test('if the stock record is out of step, the cancel is refused and nothing is half done', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  setStock('HDPE-001', 10);
  db.run(`UPDATE Item SET Reserved = 0 WHERE Code = 'HDPE-001'`);
  // Free everything held by earlier RFs on this item, then reserve once.
  db.run(`UPDATE RequisitionLine SET QtyReserved = 0, QtyShort = 0 WHERE ItemId = @id`, { id: itemId('HDPE-001') });
  const { id } = await approvedRf(foreman, owner, [['HDPE-001', 4]]);
  // Break the record on purpose: the item shows less reserved than the RF holds.
  db.run(`UPDATE Item SET Reserved = 1 WHERE Code = 'HDPE-001'`);
  const slipsBefore = db.get('SELECT COUNT(*) AS n FROM IssuanceSlip').n;

  assert.match(await errorOf(await ownerCancel(owner, id, 'Check this'), 409), /stock record does not match/);
  assert.strictEqual(row(id).Status, 'approved', 'the status change was undone with the rest');
  assert.deepStrictEqual(lines(id).map((l) => l.QtyReserved), [4]);
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 1 });
  assert.strictEqual(history(id).at(-1).ToStatus, 'approved');
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM IssuanceSlip').n, slipsBefore);
});
