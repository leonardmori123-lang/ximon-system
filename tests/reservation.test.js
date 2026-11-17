// Approving an RF reserves stock. Real database; the purchasing handoff is replaced by a recorder.
const test = require('node:test');
const assert = require('node:assert');

const handoffPath = require.resolve('../server/services/handoff');
const handoffCalls = [];
let handoffShouldFail = false;
require.cache[handoffPath] = {
  id: handoffPath, filename: handoffPath, loaded: true,
  exports: {
    createPurchaseRequisition: (input) => {
      handoffCalls.push(input);
      if (handoffShouldFail) throw new Error('purchasing is broken');
      return { prNumber: 'PR-TEST-0001' };
    },
  },
};

const { db, user, item, itemId, rfBody } = require('./helpers');
const rf = require('../server/services/requisitions');

const foreman = user('foreman1');
const owner = user('owner1');
const lineOf = (rfId, code) => ({ ...db.get('SELECT QtyReserved, QtyShort FROM RequisitionLine WHERE RequisitionId = @rfId AND ItemId = @itemId', { rfId, itemId: itemId(code) }) });

test('enough stock: everything is reserved and purchasing is not called', () => {
  const { id } = rf.createRequisition(foreman, rfBody([['HDPE-001', 3]]));
  const out = rf.approveRequisition(owner, id);
  assert.strictEqual(out.status, 'approved');
  assert.strictEqual(out.shortLines, 0);
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 3 });
  assert.deepStrictEqual(lineOf(id, 'HDPE-001'), { QtyReserved: 3, QtyShort: 0 });
  assert.strictEqual(handoffCalls.length, 0);
});

test('no stock: nothing reserved, the shortage goes to purchasing', () => {
  const { id, rfNumber } = rf.createRequisition(foreman, rfBody([['ACU-001', 1]]));
  const out = rf.approveRequisition(owner, id);
  assert.strictEqual(out.shortLines, 1);
  assert.deepStrictEqual(out.purchaseRequisition, { prNumber: 'PR-TEST-0001' });
  assert.deepStrictEqual(lineOf(id, 'ACU-001'), { QtyReserved: 0, QtyShort: 1 });
  assert.strictEqual(handoffCalls.length, 1);
  assert.deepStrictEqual(handoffCalls[0], {
    requisitionId: id, rfNumber, projectId: handoffCalls[0].projectId, lines: [{ itemId: itemId('ACU-001'), shortQty: 1 }],
  });
});

test('a second approval only gets what is left (7 of 9), and the item list shows it', () => {
  const { id } = rf.createRequisition(foreman, rfBody([['HDPE-001', 9]]));
  rf.approveRequisition(owner, id);
  assert.deepStrictEqual(lineOf(id, 'HDPE-001'), { QtyReserved: 7, QtyShort: 2 });
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: 10, Reserved: 10 });
});

test('approving twice is refused and reserves nothing extra', () => {
  const { id } = rf.createRequisition(foreman, rfBody([['HDPE-002', 1]]));
  rf.approveRequisition(owner, id);
  assert.throws(() => rf.approveRequisition(owner, id), (e) => e.status === 409);
});

test('if purchasing fails, the approval and the reservation are undone together', () => {
  const before = item('HDPE-003');
  const { id } = rf.createRequisition(foreman, rfBody([['HDPE-003', 2]]));
  handoffShouldFail = true;
  assert.throws(() => rf.approveRequisition(owner, id), /purchasing is broken/);
  handoffShouldFail = false;
  assert.strictEqual(rf.getRequisition(owner, id).Status, 'pending');
  assert.deepStrictEqual(lineOf(id, 'HDPE-003'), { QtyReserved: 0, QtyShort: 0 });
  assert.deepStrictEqual(item('HDPE-003'), before);
  const history = rf.getRequisition(owner, id).history.map((h) => h.ToStatus);
  assert.deepStrictEqual(history, ['pending']);
});
