// Delivery into stock: receiveStock shelves units; allocateToRequisition sets them aside for the RF (handoff is a stub).
const test = require('node:test');
const assert = require('node:assert');
const { db, user, item, itemId, rfBody } = require('./helpers');
const rf = require('../server/services/requisitions');
const slips = require('../server/services/issuance');
const { receiveStock, allocateToRequisition } = require('../server/services/receipts');
const { planAllocation } = require('../server/services/stockRules');

const foreman = user('foreman1');
const owner = user('owner1');
const custodian = user('custodian1');
const receiver = user('verifier1');
const rejects = (fn, status, text) => assert.throws(fn, (e) => e.status === status && (!text || e.message.includes(text)));

let reportNumber = 0; // a stand-in for the receiving report id
const receive = (code, quantity) => receiveStock({ itemId: itemId(code), quantity, sourceDocument: { type: 'RR', id: ++reportNumber, number: `RR-TEST-${reportNumber}` }, userId: receiver.id });
const allocate = (requisitionId, lines) => allocateToRequisition({ requisitionId, lines: lines.map(([code, quantity]) => ({ itemId: itemId(code), quantity })), userId: receiver.id });
const approved = (lines) => { const { id } = rf.createRequisition(foreman, rfBody(lines)); rf.approveRequisition(owner, id); return id; };
const lineOf = (id, code) => ({ ...db.get('SELECT QtyReserved, QtyShort, QtyIssued FROM RequisitionLine WHERE RequisitionId = @id AND ItemId = @itemId', { id, itemId: itemId(code) }) });
const notices = (userId) => db.all('SELECT Message, LinkUrl FROM Notification WHERE UserId = @userId ORDER BY NotificationId', { userId });

function assertLogMatchesStock() {
  const rows = db.all(`SELECT i.Code, i.OnHand, ROUND(COALESCE(SUM(t.Quantity), 0), 2) AS Logged
                       FROM Item i LEFT JOIN StockTransaction t ON t.ItemId = i.ItemId GROUP BY i.ItemId`);
  for (const r of rows) assert.strictEqual(r.Logged + 0, r.OnHand, `${r.Code}: log ${r.Logged} vs on hand ${r.OnHand}`);
}

test('the allocation rule: what the RF lacks, what arrived, what is free, whichever is smallest', () => {
  assert.strictEqual(planAllocation(5, 2, 5), 2);
  assert.strictEqual(planAllocation(1, 2, 5), 1);
  assert.strictEqual(planAllocation(5, 2, 1), 1);
  assert.strictEqual(planAllocation(5, 0, 5), 0);
  assert.strictEqual(planAllocation(5, 2, -1), 0);
  assert.strictEqual(planAllocation(0.1, 0.3, 0.3), 0.1);
  assert.strictEqual(planAllocation(0.3, 0.1 + 0.2, 1), 0.3);
});

test('receiveStock adds the units, logs a receipt, and the log still adds up', () => {
  const out = receive('HDPE-002', 4);
  assert.strictEqual(out.onHand, 4);
  assert.deepStrictEqual(item('HDPE-002'), { OnHand: 4, Reserved: 0 });
  const tx = db.get('SELECT TxType, Quantity, RefDocType, RefDocId, Note, CreatedBy FROM StockTransaction WHERE TransactionId = @id', { id: out.transactionId });
  assert.deepStrictEqual({ ...tx }, { TxType: 'receipt', Quantity: 4, RefDocType: 'RR', RefDocId: reportNumber, Note: `RR-TEST-${reportNumber}`, CreatedBy: receiver.id });
  receive('HDPE-002', 0.25);
  assert.strictEqual(item('HDPE-002').OnHand, 4.25);
  assertLogMatchesStock();
});

test('receiveStock refuses bad input and changes nothing', () => {
  const before = db.get('SELECT COUNT(*) AS n FROM StockTransaction').n;
  const base = { itemId: itemId('HDPE-003'), quantity: 1, sourceDocument: { type: 'RR', id: 1 }, userId: receiver.id };
  rejects(() => receiveStock({ ...base, quantity: 0 }), 400, 'above zero');
  rejects(() => receiveStock({ ...base, quantity: -2 }), 400, 'above zero');
  rejects(() => receiveStock({ ...base, quantity: 1.234 }), 400, '2 decimals');
  rejects(() => receiveStock({ ...base, userId: undefined }), 400, 'userId');
  rejects(() => receiveStock({ ...base, sourceDocument: undefined }), 400, 'receiving report');
  rejects(() => receiveStock({ ...base, itemId: 999999 }), 404, 'Item not found');
  rejects(() => receiveStock(undefined), 400);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM StockTransaction').n, before);
  assert.strictEqual(item('HDPE-003').OnHand, 0);
});

test('full story: a shortage is delivered, set aside for the RF, slipped, released and confirmed', () => {
  const id = approved([['ACU-001', 2]]);
  assert.deepStrictEqual(lineOf(id, 'ACU-001'), { QtyReserved: 0, QtyShort: 2, QtyIssued: 0 });

  receive('ACU-001', 2);
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 2, Reserved: 0 }); // on the shelf, but not yet the RF's
  const out = allocate(id, [['ACU-001', 2]]);

  assert.deepStrictEqual(out.allocated, [{ itemId: itemId('ACU-001'), quantity: 2 }]);
  assert.match(out.slip.slipNumber, /^IS-\d{4}-\d{4}$/);
  assert.deepStrictEqual(lineOf(id, 'ACU-001'), { QtyReserved: 2, QtyShort: 0, QtyIssued: 0 });
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 2, Reserved: 2 });
  assert.strictEqual(slips.getSlip(custodian, out.slip.id).lines[0].Quantity, 2);
  assert.strictEqual(slips.getSlip(custodian, out.slip.id).Status, 'prepared');
  assert.ok(notices(foreman.id).some((n) => n.Message.includes('set aside for you') && n.LinkUrl === `/requisition.html?id=${id}`));
  assert.ok(notices(custodian.id).some((n) => n.Message.startsWith(out.slip.slipNumber) && n.LinkUrl === `/slip.html?id=${out.slip.id}`));

  slips.releaseSlip(custodian, out.slip.id);
  assert.strictEqual(slips.acknowledgeSlip(foreman, out.slip.id).requisitionStatus, 'fulfilled');
  assert.deepStrictEqual(item('ACU-001'), { OnHand: 0, Reserved: 0 });
  assertLogMatchesStock();
});

test('a partial delivery is allocated first, the rest later, and the RF closes at the end', () => {
  const id = approved([['HDPE-004', 3]]);
  receive('HDPE-004', 1);
  const first = allocate(id, [['HDPE-004', 1]]);
  assert.deepStrictEqual(lineOf(id, 'HDPE-004'), { QtyReserved: 1, QtyShort: 2, QtyIssued: 0 });
  slips.releaseSlip(custodian, first.slip.id);
  assert.strictEqual(slips.acknowledgeSlip(foreman, first.slip.id).requisitionStatus, 'partly_fulfilled');

  receive('HDPE-004', 2);
  const second = allocate(id, [['HDPE-004', 2]]);
  assert.notStrictEqual(second.slip.id, first.slip.id);
  assert.deepStrictEqual(lineOf(id, 'HDPE-004'), { QtyReserved: 3, QtyShort: 0, QtyIssued: 1 });
  slips.releaseSlip(custodian, second.slip.id);
  assert.strictEqual(slips.acknowledgeSlip(foreman, second.slip.id).requisitionStatus, 'fulfilled');
  assert.deepStrictEqual(lineOf(id, 'HDPE-004'), { QtyReserved: 3, QtyShort: 0, QtyIssued: 3 });
  assert.deepStrictEqual(item('HDPE-004'), { OnHand: 0, Reserved: 0 });
  assertLogMatchesStock();
});

test('a delivery above the shortage gives the RF only what it lacks; the rest stays free', () => {
  const id = approved([['HDPE-005', 2]]);
  receive('HDPE-005', 5);
  const out = allocate(id, [['HDPE-005', 5]]);
  assert.deepStrictEqual(out.allocated, [{ itemId: itemId('HDPE-005'), quantity: 2 }]);
  assert.deepStrictEqual(item('HDPE-005'), { OnHand: 5, Reserved: 2 });
  assert.deepStrictEqual(lineOf(id, 'HDPE-005'), { QtyReserved: 2, QtyShort: 0, QtyIssued: 0 });
});

test('an RF with an open slip is not given a second slip; the custodian is told instead', () => {
  const id = approved([['HDPE-006', 3]]);
  receive('HDPE-006', 1);
  const first = allocate(id, [['HDPE-006', 1]]);
  receive('HDPE-006', 2);
  const second = allocate(id, [['HDPE-006', 2]]);

  assert.deepStrictEqual(second.allocated, [{ itemId: itemId('HDPE-006'), quantity: 2 }]);
  assert.strictEqual(second.slip, null);
  assert.deepStrictEqual(lineOf(id, 'HDPE-006'), { QtyReserved: 3, QtyShort: 0, QtyIssued: 0 });
  assert.ok(notices(custodian.id).some((n) => n.Message.includes('more reserved items waiting') && n.LinkUrl === '/slips.html'));
  assert.ok(!slips.listReleasable().some((r) => r.RequisitionId === id), 'hidden while the first slip is open');

  slips.releaseSlip(custodian, first.slip.id);
  slips.acknowledgeSlip(foreman, first.slip.id);
  assert.ok(slips.listReleasable().some((r) => r.RequisitionId === id), 'offered again once the first slip is confirmed');
});

test('items that are not on the RF, RFs that are not approved, and unknown RFs get nothing', () => {
  const id = approved([['HDPE-003', 1]]);
  receive('HDPE-001', 1);
  assert.deepStrictEqual(allocate(id, [['HDPE-001', 1]]), { allocated: [], slip: null });

  const pending = rf.createRequisition(foreman, rfBody([['HDPE-003', 1]])).id;
  receive('HDPE-003', 1);
  assert.deepStrictEqual(allocate(pending, [['HDPE-003', 1]]), { allocated: [], slip: null });
  assert.deepStrictEqual(lineOf(pending, 'HDPE-003'), { QtyReserved: 0, QtyShort: 0, QtyIssued: 0 });

  rejects(() => allocate(999999, [['HDPE-003', 1]]), 404, 'Requisition not found');
  rejects(() => allocateToRequisition({ requisitionId: id, lines: [], userId: receiver.id }), 400, 'received lines');
  rejects(() => allocateToRequisition({ requisitionId: id, lines: [{ itemId: itemId('HDPE-003'), quantity: 0 }], userId: receiver.id }), 400);
  rejects(() => allocateToRequisition({ requisitionId: id, lines: [{ itemId: itemId('HDPE-003'), quantity: 1 }] }), 400, 'userId');
});

test('stock that someone else has reserved is never handed out', () => {
  // Earlier tests leave 9 on hand: the first RF reserves it all.
  const free = item('HDPE-001').OnHand - item('HDPE-001').Reserved;
  approved([['HDPE-001', free]]);
  const second = approved([['HDPE-001', 2]]);
  assert.deepStrictEqual(lineOf(second, 'HDPE-001'), { QtyReserved: 0, QtyShort: 2, QtyIssued: 0 });
  assert.deepStrictEqual(allocate(second, [['HDPE-001', 2]]), { allocated: [], slip: null }); // nothing free yet
  assert.strictEqual(item('HDPE-001').Reserved, item('HDPE-001').OnHand);
});

test('both calls run in the caller\'s transaction, so one failure undoes the delivery', () => {
  const id = approved([['ACU-001', 1]]);
  const stock = item('ACU-001');
  const slipCount = db.get('SELECT COUNT(*) AS n FROM IssuanceSlip').n;
  const txCount = db.get('SELECT COUNT(*) AS n FROM StockTransaction').n;
  assert.throws(() => db.transaction(() => {
    receive('ACU-001', 1);
    allocate(id, [['ACU-001', 1]]);
    throw new Error('the receiving report failed');
  }), /receiving report failed/);
  assert.deepStrictEqual(item('ACU-001'), stock);
  assert.deepStrictEqual(lineOf(id, 'ACU-001'), { QtyReserved: 0, QtyShort: 1, QtyIssued: 0 });
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM IssuanceSlip').n, slipCount);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM StockTransaction').n, txCount);
});
