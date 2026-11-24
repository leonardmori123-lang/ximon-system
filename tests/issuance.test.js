// Release side: slip, release, confirm. Real database, real SQL.
const test = require('node:test');
const assert = require('node:assert');
const { db, user, item, itemId, rfBody } = require('./helpers');
const rf = require('../server/services/requisitions');
const slips = require('../server/services/issuance');

const foreman = user('foreman1');
const owner = user('owner1');
const custodian = user('custodian1');
const rejects = (fn, status, text) => assert.throws(fn, (e) => e.status === status && (!text || e.message.includes(text)));
const rfRow = (id) => rf.getRequisition(owner, id);
const approved = (lines) => { const { id } = rf.createRequisition(foreman, rfBody(lines)); rf.approveRequisition(owner, id); return id; };

// The log must match stock; ROUND decimal sums (0.3 - 0.1 - 0.2 is -2.7e-17) and add 0 to avoid -0.
function assertLogMatchesStock() {
  const rows = db.all(`SELECT i.Code, i.OnHand, ROUND(COALESCE(SUM(t.Quantity), 0), 2) AS Logged
                       FROM Item i LEFT JOIN StockTransaction t ON t.ItemId = i.ItemId GROUP BY i.ItemId`);
  for (const r of rows) assert.strictEqual(r.Logged + 0, r.OnHand, `${r.Code}: log ${r.Logged} vs on hand ${r.OnHand}`);
}

test('full story: prepare, release, confirm. Stock leaves, RF closes, the log adds up', () => {
  const id = approved([['HDPE-001', 3]]);
  assert.ok(slips.listReleasable().some((r) => r.RequisitionId === id));

  const { id: slipId, slipNumber } = slips.prepareSlip(custodian, id);
  assert.match(slipNumber, /^IS-\d{4}-\d{4}$/);
  assert.ok(!slips.listReleasable().some((r) => r.RequisitionId === id), 'an RF with an open slip is not offered again');

  slips.releaseSlip(custodian, slipId);
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 3 }); // nothing deducted at release
  const out = slips.acknowledgeSlip(foreman, slipId, ' all good ');

  assert.deepStrictEqual({ ...out }, { id: slipId, status: 'acknowledged', requisitionStatus: 'fulfilled' });
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 7, Reserved: 0 });
  const full = rfRow(id);
  assert.strictEqual(full.Status, 'fulfilled');
  assert.strictEqual(full.lines[0].QtyIssued, 3);
  assert.deepStrictEqual(full.history.map((h) => h.ToStatus), ['pending', 'approved', 'fulfilled']);
  const slip = slips.getSlip(foreman, slipId);
  assert.strictEqual(slip.Status, 'acknowledged');
  assert.strictEqual(slip.Remarks, 'all good');
  assert.deepStrictEqual(slip.history.map((h) => h.ToStatus), ['prepared', 'released', 'acknowledged']);
  const tx = db.get(`SELECT Quantity, TxType, CreatedBy FROM StockTransaction WHERE RefDocType = 'IS' AND RefDocId = @slipId`, { slipId });
  assert.deepStrictEqual({ ...tx }, { Quantity: -3, TxType: 'issue', CreatedBy: custodian.id });
  assertLogMatchesStock();
});

test('an RF with a shortage becomes partly fulfilled, and stays open', () => {
  // HDPE-001 has 7 on hand now; ask for 9 -> 7 reserved, 2 short
  const id = approved([['HDPE-001', 9]]);
  const { id: slipId } = slips.prepareSlip(custodian, id);
  assert.strictEqual(slips.getSlip(custodian, slipId).lines[0].Quantity, 7);
  slips.releaseSlip(custodian, slipId);
  assert.strictEqual(slips.acknowledgeSlip(foreman, slipId).requisitionStatus, 'partly_fulfilled');
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 0, Reserved: 0 });
  assert.strictEqual(rfRow(id).Status, 'partly_fulfilled');
  rejects(() => slips.prepareSlip(custodian, id), 409, 'Nothing is reserved'); // nothing left to release
  assertLogMatchesStock();
});

test('guards: wrong status, wrong person, double confirm, open slip', () => {
  const pending = rf.createRequisition(foreman, rfBody([['HDPE-002', 1]])).id;
  rejects(() => slips.prepareSlip(custodian, pending), 409, 'approved');
  rejects(() => slips.prepareSlip(custodian, 9999), 404);

  rf.approveRequisition(owner, pending); // 0 on hand -> all short
  rejects(() => slips.prepareSlip(custodian, pending), 409, 'Nothing is reserved');

  const id = approved([['HDPE-004', 1]]); // also 0 on hand
  assert.ok(id);
});

test('release and confirm only in the right order, by the right person', () => {
  db.run(`UPDATE Item SET OnHand = 5 WHERE Code = 'HDPE-005'`); // give it stock for this test
  db.run(`INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy) VALUES (@itemId, 'adjustment', 5, @userId)`, { itemId: itemId('HDPE-005'), userId: owner.id });
  const id = approved([['HDPE-005', 2]]);
  const { id: slipId } = slips.prepareSlip(custodian, id);

  rejects(() => slips.prepareSlip(custodian, id), 409, 'still open');
  rejects(() => slips.acknowledgeSlip(foreman, slipId), 409, 'not waiting'); // not released yet
  slips.releaseSlip(custodian, slipId);
  rejects(() => slips.releaseSlip(custodian, slipId), 409);
  rejects(() => slips.cancelSlip(custodian, slipId), 409); // too late to cancel
  rejects(() => slips.acknowledgeSlip({ id: owner.id, role: 'foreman' }, slipId), 403);
  rejects(() => slips.acknowledgeSlip(foreman, slipId, 'x'.repeat(201)), 400);
  slips.acknowledgeSlip(foreman, slipId);
  rejects(() => slips.acknowledgeSlip(foreman, slipId), 409); // a second tap does nothing
  assert.deepStrictEqual(item('HDPE-005'), { OnHand: 3, Reserved: 0 });
  assertLogMatchesStock();
});

test('a cancelled slip frees the RF for a new slip', () => {
  db.run(`UPDATE Item SET OnHand = 4 WHERE Code = 'HDPE-006'`);
  db.run(`INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy) VALUES (@itemId, 'adjustment', 4, @userId)`, { itemId: itemId('HDPE-006'), userId: owner.id });
  const id = approved([['HDPE-006', 1]]);
  const first = slips.prepareSlip(custodian, id);
  slips.cancelSlip(custodian, first.id);
  const second = slips.prepareSlip(custodian, id);
  assert.notStrictEqual(second.id, first.id);
  assert.strictEqual(slips.getSlip(custodian, first.id).Status, 'cancelled');
  assert.deepStrictEqual(item('HDPE-006'), { OnHand: 4, Reserved: 1 }); // still reserved
});

test('a stock record that does not match the slip is refused and nothing moves', () => {
  db.run(`UPDATE Item SET OnHand = 5 WHERE Code = 'HDPE-003'`);
  db.run(`INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy) VALUES (@itemId, 'adjustment', 5, @userId)`, { itemId: itemId('HDPE-003'), userId: owner.id });
  const id = approved([['HDPE-003', 2]]);
  const { id: slipId } = slips.prepareSlip(custodian, id);
  slips.releaseSlip(custodian, slipId);
  db.run(`UPDATE Item SET Reserved = 0 WHERE Code = 'HDPE-003'`); // someone corrupted the reservation
  rejects(() => slips.acknowledgeSlip(foreman, slipId), 409, 'does not match');
  assert.strictEqual(slips.getSlip(custodian, slipId).Status, 'released'); // rolled back
  assert.deepStrictEqual(item('HDPE-003'), { OnHand: 5, Reserved: 0 });
});

test('decimal quantities do not drift (0.1 + 0.2 style)', () => {
  db.run(`INSERT INTO Item (Code, Description, Unit, OnHand) VALUES ('PIPE-1', 'Test pipe', 'm', 0.3)`);
  db.run(`INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy) VALUES (@itemId, 'adjustment', 0.3, @userId)`, { itemId: itemId('PIPE-1'), userId: owner.id });
  const a = approved([['PIPE-1', 0.1]]);
  const b = approved([['PIPE-1', 0.2]]);
  assert.deepStrictEqual(item('PIPE-1'), { OnHand: 0.3, Reserved: 0.3 });
  for (const id of [a, b]) {
    const s = slips.prepareSlip(custodian, id);
    slips.releaseSlip(custodian, s.id);
    slips.acknowledgeSlip(foreman, s.id);
    assert.strictEqual(rfRow(id).Status, 'fulfilled');
  }
  assert.deepStrictEqual(item('PIPE-1'), { OnHand: 0, Reserved: 0 });
  assertLogMatchesStock();
});
