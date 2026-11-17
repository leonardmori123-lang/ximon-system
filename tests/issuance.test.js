// Runs the issuance service against a small in-memory fake database.
const test = require('node:test');
const assert = require('node:assert');

let db;
function reset() {
  db = {
    items: { 1: { OnHand: 10, Reserved: 3 }, 2: { OnHand: 0, Reserved: 0 } },
    rf: { 1: { Status: 'approved', RequestedBy: 2, ProjectId: 1 } },
    rfLines: [
      { LineId: 1, RequisitionId: 1, ItemId: 1, Quantity: 3, QtyReserved: 3, QtyIssued: 0 },
      { LineId: 2, RequisitionId: 1, ItemId: 2, Quantity: 1, QtyReserved: 0, QtyIssued: 0 },
    ],
    slips: { 1: { Status: 'released', RequisitionId: 1, ReleasedBy: 3, SlipNumber: 'IS-2026-0001' } },
    slipLines: [{ SlipId: 1, RequisitionLineId: 1, ItemId: 1, Quantity: 3 }],
    insertedSlipLines: [], txns: [], history: [], openSlips: [], nextSlipId: 7,
  };
}
reset();

class FakeRequest {
  constructor() { this.p = {}; }
  input(name, type, value) { this.p[name] = value === undefined ? type : value; return this; }
  async query(raw) {
    const t = raw.replace(/\s+/g, ' ').trim();
    const p = this.p;
    if (t.includes('FROM dbo.IssuanceSlip s WITH (UPDLOCK')) {
      const s = db.slips[p.id]; if (!s) return { recordset: [] };
      const r = db.rf[s.RequisitionId];
      return { recordset: [{ ...s, RequestedBy: r.RequestedBy, ProjectId: r.ProjectId }] };
    }
    if (t.startsWith('UPDATE dbo.IssuanceSlip SET Status = \'acknowledged\'')) { db.slips[p.id].Status = 'acknowledged'; return { rowsAffected: [1] }; }
    if (t.includes('FROM dbo.IssuanceLine WHERE SlipId')) {
      return { recordset: db.slipLines.filter((l) => l.SlipId === p.id).sort((a, b) => a.ItemId - b.ItemId) };
    }
    if (t.startsWith('UPDATE dbo.Item SET OnHand')) {
      const it = db.items[p.itemId];
      if (it.Reserved >= p.qty && it.OnHand >= p.qty) { it.OnHand -= p.qty; it.Reserved -= p.qty; return { rowsAffected: [1] }; }
      return { rowsAffected: [0] };
    }
    if (t.startsWith('UPDATE dbo.RequisitionLine SET QtyIssued')) {
      const l = db.rfLines.find((x) => x.LineId === p.lineId);
      if (l.QtyIssued + p.qty <= l.QtyReserved) { l.QtyIssued += p.qty; return { rowsAffected: [1] }; }
      return { rowsAffected: [0] };
    }
    if (t.startsWith('INSERT INTO dbo.StockTransaction')) { db.txns.push({ ...p }); return { rowsAffected: [1] }; }
    if (t.includes('COUNT(*) AS Remaining')) {
      return { recordset: [{ Remaining: db.rfLines.filter((l) => l.RequisitionId === p.rid && l.QtyIssued < l.Quantity).length }] };
    }
    if (t.startsWith('SELECT Status FROM dbo.Requisition WITH (UPDLOCK')) {
      return { recordset: db.rf[p.rid || p.id] ? [{ Status: db.rf[p.rid || p.id].Status }] : [] };
    }
    if (t.startsWith('UPDATE dbo.Requisition SET Status = @status')) { db.rf[p.rid].Status = p.status; return { rowsAffected: [1] }; }
    if (t.startsWith('INSERT INTO dbo.StatusHistory')) { db.history.push({ ...p }); return { rowsAffected: [1] }; }
    // prepareSlip
    if (t.startsWith('SELECT SlipNumber FROM dbo.IssuanceSlip WHERE RequisitionId')) return { recordset: db.openSlips };
    if (t.includes('QtyReserved - QtyIssued AS Qty')) {
      return { recordset: db.rfLines.filter((l) => l.RequisitionId === p.id && l.QtyReserved - l.QtyIssued > 0)
        .map((l) => ({ LineId: l.LineId, ItemId: l.ItemId, Qty: l.QtyReserved - l.QtyIssued })) };
    }
    if (t.includes('NumberSequence')) return { recordset: [{ n: 1 }] };
    if (t.startsWith('INSERT INTO dbo.IssuanceSlip')) return { recordset: [{ SlipId: db.nextSlipId }] };
    if (t.startsWith('INSERT INTO dbo.IssuanceLine')) { db.insertedSlipLines.push({ ...p }); return { rowsAffected: [1] }; }
    throw new Error('unexpected query: ' + t);
  }
}
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    sql: { Request: FakeRequest, Int: 'Int', Decimal: () => 'Decimal', NVarChar: () => 'NVarChar', VarChar: () => 'VarChar' },
    query: async () => [], withTransaction: async (fn) => fn({}),
  },
};
const { acknowledgeSlip, prepareSlip } = require('../server/services/issuance');
const foreman = { id: 2, role: 'foreman' };
const custodian = { id: 3, role: 'custodian' };
const rejects = (promise, status, text) =>
  assert.rejects(promise, (err) => err.status === status && (!text || err.message.includes(text)));

test('confirming receipt deducts stock, logs it, and marks the RF partly fulfilled when an item is still short', async () => {
  reset();
  const result = await acknowledgeSlip(foreman, 1, ' all good ');
  assert.deepStrictEqual(result, { id: 1, status: 'acknowledged', requisitionStatus: 'partly_fulfilled' });
  assert.deepStrictEqual(db.items[1], { OnHand: 7, Reserved: 0 });
  assert.strictEqual(db.rfLines[0].QtyIssued, 3);
  assert.deepStrictEqual(db.txns.map((x) => [x.itemId, x.qty, x.userId, x.note]), [[1, -3, 3, 'IS-2026-0001']]);
  assert.strictEqual(db.rf[1].Status, 'partly_fulfilled');
  assert.deepStrictEqual(db.history.map((h) => `${h.docType} ${h.from}>${h.to}`), ['RF approved>partly_fulfilled', 'IS released>acknowledged']);
  assert.strictEqual(db.history[1].reason, 'all good');
});

test('when every line is fully issued the RF is closed as fulfilled', async () => {
  reset();
  db.rfLines.pop(); // only the HDPE line
  const result = await acknowledgeSlip(foreman, 1);
  assert.strictEqual(result.requisitionStatus, 'fulfilled');
  assert.strictEqual(db.rf[1].Status, 'fulfilled');
});

test('only the requestor can confirm, and only a released slip', async () => {
  reset();
  await rejects(acknowledgeSlip({ id: 9, role: 'foreman' }, 1), 403);
  db.slips[1].Status = 'prepared';
  await rejects(acknowledgeSlip(foreman, 1), 409, 'not waiting');
  await rejects(acknowledgeSlip(foreman, 99), 404);
  assert.deepStrictEqual(db.items[1], { OnHand: 10, Reserved: 3 }); // nothing moved
});

test('a stock record that does not match the slip is refused', async () => {
  reset();
  db.items[1].Reserved = 1; // slip says 3 but only 1 is reserved
  await rejects(acknowledgeSlip(foreman, 1), 409, 'does not match');
});

test('remarks longer than 200 characters are refused', async () => {
  reset();
  await rejects(acknowledgeSlip(foreman, 1, 'x'.repeat(201)), 400);
});

test('prepare slip takes what is reserved and not yet issued', async () => {
  reset();
  const out = await prepareSlip(custodian, 1);
  assert.deepStrictEqual(out, { id: 7, slipNumber: 'IS-2026-0001' });
  assert.deepStrictEqual(db.insertedSlipLines.map((l) => [l.lineId, l.itemId, l.qty]), [[1, 1, 3]]);
  assert.strictEqual(db.history[0].to, 'prepared');
});

test('prepare slip is refused for a wrong status, an open slip, or nothing reserved', async () => {
  reset(); db.rf[1].Status = 'pending';
  await rejects(prepareSlip(custodian, 1), 409, 'approved');
  reset(); db.openSlips = [{ SlipNumber: 'IS-2026-0005' }];
  await rejects(prepareSlip(custodian, 1), 409, 'IS-2026-0005');
  reset(); db.rfLines[0].QtyIssued = 3;
  await rejects(prepareSlip(custodian, 1), 409, 'Nothing is reserved');
  reset();
  await rejects(prepareSlip(custodian, 5), 404);
});
