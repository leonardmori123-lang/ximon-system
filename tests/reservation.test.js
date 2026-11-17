// Runs reserveForRequisition against a tiny fake database that keeps items and lines in memory.
const test = require('node:test');
const assert = require('node:assert');

const items = {};   // ItemId -> { OnHand, Reserved }
const lines = [];   // { LineId, ItemId, Quantity, QtyReserved, QtyShort }
const log = [];

class FakeRequest {
  constructor() { this.params = {}; }
  input(name, _type, value) { this.params[name] = value === undefined ? _type : value; return this; }
  async query(text) {
    const p = this.params;
    if (text.includes('FROM dbo.RequisitionLine')) {
      const rows = lines.map(({ LineId, ItemId, Quantity }) => ({ LineId, ItemId, Quantity })).sort((a, b) => a.ItemId - b.ItemId);
      return { recordset: rows };
    }
    if (text.includes('WITH (UPDLOCK, ROWLOCK)')) {
      log.push(`lock ${p.itemId}`);
      const it = items[p.itemId];
      return { recordset: [{ Available: it.OnHand - it.Reserved }] };
    }
    if (text.startsWith('UPDATE dbo.Item')) {
      items[p.itemId].Reserved += p.reserve;
      assert.ok(items[p.itemId].Reserved <= items[p.itemId].OnHand, 'Reserved must never pass OnHand');
      return { recordset: [] };
    }
    if (text.startsWith('UPDATE dbo.RequisitionLine')) {
      const line = lines.find((l) => l.LineId === p.lineId);
      line.QtyReserved = p.reserve; line.QtyShort = p.short;
      return { recordset: [] };
    }
    throw new Error('unexpected query: ' + text);
  }
}
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { sql: { Request: FakeRequest, Int: 'Int', Decimal: () => 'Decimal' }, query: async () => [], withTransaction: async (fn) => fn({}) },
};
const { reserveForRequisition } = require('../server/services/reservation');

function setup(stock, wanted) {
  for (const k of Object.keys(items)) delete items[k];
  lines.length = 0; log.length = 0;
  Object.entries(stock).forEach(([id, onHand]) => { items[id] = { OnHand: onHand, Reserved: 0 }; });
  wanted.forEach(([ItemId, Quantity], i) => lines.push({ LineId: i + 1, ItemId, Quantity, QtyReserved: 0, QtyShort: 0 }));
}

test('all stock available: everything reserved, no shortages', async () => {
  setup({ 1: 10 }, [[1, 3]]);
  assert.deepStrictEqual(await reserveForRequisition({}, 1), []);
  assert.strictEqual(items[1].Reserved, 3);
  assert.deepStrictEqual([lines[0].QtyReserved, lines[0].QtyShort], [3, 0]);
});

test('partly available: reserves what exists and returns the shortage', async () => {
  setup({ 1: 10, 2: 0 }, [[1, 3], [2, 1]]);
  const shortages = await reserveForRequisition({}, 1);
  assert.deepStrictEqual(shortages, [{ itemId: 2, shortQty: 1 }]);
  assert.strictEqual(items[1].Reserved, 3);
  assert.strictEqual(items[2].Reserved, 0);
  assert.deepStrictEqual([lines[1].QtyReserved, lines[1].QtyShort], [0, 1]);
});

test('a second approval only gets what is left', async () => {
  setup({ 1: 10 }, [[1, 3]]);
  await reserveForRequisition({}, 1);
  lines.length = 0;
  lines.push({ LineId: 9, ItemId: 1, Quantity: 9, QtyReserved: 0, QtyShort: 0 });
  const shortages = await reserveForRequisition({}, 2);
  assert.strictEqual(items[1].Reserved, 10);
  assert.deepStrictEqual(shortages, [{ itemId: 1, shortQty: 2 }]);
});

test('items are locked in item order, so two approvals cannot deadlock', async () => {
  setup({ 1: 5, 2: 5, 3: 5 }, [[3, 1], [1, 1], [2, 1]]);
  await reserveForRequisition({}, 1);
  assert.deepStrictEqual(log, ['lock 1', 'lock 2', 'lock 3']);
});
