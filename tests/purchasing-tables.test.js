// Checks db/40_purchasing.sql: it loads twice, sample prices rebuild the PO, and checks refuse bad rows.
process.env.DB_FILE = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/db');

const DIR = path.join(__dirname, '..', 'db');
function loadAllSqlFiles() {
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(DIR, file), 'utf8'));
  }
}
loadAllSqlFiles();

db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role) VALUES ('Test Purchaser', 'purchaser-x', 'x', 'purchaser')`);
const userId = db.get(`SELECT UserId FROM AppUser WHERE Username = 'purchaser-x'`).UserId;
const projectId = db.get('SELECT ProjectId FROM Project LIMIT 1').ProjectId;
const supplierId = db.get('SELECT SupplierId FROM Supplier LIMIT 1').SupplierId;
const itemId = (code) => db.get('SELECT ItemId FROM Item WHERE Code = @code', { code }).ItemId;
const count = (table) => db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;

const refuses = (fn, text) => assert.throws(fn, (err) => err.message.includes(text), `expected: ${text}`);

function newPr(prNumber, status = 'pending', reason = null) {
  return db.run(
    `INSERT INTO PurchaseRequisition (PrNumber, ProjectId, Status, Reason) VALUES (@prNumber, @projectId, @status, @reason)`,
    { prNumber, projectId, status, reason }
  ).lastId;
}
function newPo(poNumber, extra = {}) {
  const row = { poNumber, supplierId, projectId, userId, subtotal: 0, discount: 0, other: 0, shipping: 0, total: 0, ...extra };
  return db.run(
    `INSERT INTO PurchaseOrder (PoNumber, SupplierId, ProjectId, CreatedBy, SubtotalCentavos, DiscountCentavos,
                                OtherDiscountCentavos, ShippingCentavos, TotalCentavos)
     VALUES (@poNumber, @supplierId, @projectId, @userId, @subtotal, @discount, @other, @shipping, @total)`,
    row
  ).lastId;
}

test('running the file again changes nothing', () => {
  const before = [count('Supplier'), count('SupplierPrice')];
  loadAllSqlFiles();
  assert.deepStrictEqual([count('Supplier'), count('SupplierPrice')], before);
  assert.deepStrictEqual(before, [1, 6]);
});

test('the sample prices rebuild the client PO to the cent', () => {
  const qty = [11, 5, 20, 4, 30, 24];
  const codes = ['HDPE-001', 'HDPE-002', 'HDPE-003', 'HDPE-004', 'HDPE-005', 'HDPE-006'];
  const prices = codes.map((c) => db.get('SELECT UnitPriceCentavos AS p FROM SupplierPrice WHERE ItemId = @id', { id: itemId(c) }).p);
  const lines = qty.map((q, i) => Math.round(q * prices[i]));
  assert.deepStrictEqual(lines, [585926, 845635, 862680, 504236, 2959230, 5529216]);

  const subtotal = lines.reduce((a, b) => a + b, 0);
  const discount = Math.round((subtotal * 58) / 100); // 58% discount, rounded to the centavo
  const total = subtotal - discount;
  assert.deepStrictEqual([subtotal, discount, total], [11286923, 6546415, 4740508]);

  const poId = newPo('PO-TEST-0001', { subtotal, discount, total });
  codes.forEach((c, i) => db.run(
    `INSERT INTO POLine (PurchaseOrderId, ItemId, Quantity, UnitPriceCentavos, LineTotalCentavos) VALUES (@poId, @itemId, @q, @p, @l)`,
    { poId, itemId: itemId(c), q: qty[i], p: prices[i], l: lines[i] }
  ));
  assert.strictEqual(db.get('SELECT SUM(LineTotalCentavos) AS s FROM POLine WHERE PurchaseOrderId = @poId', { poId }).s, subtotal);
});

test('the saved PO total must add up, and so must each line total', () => {
  refuses(() => newPo('PO-TEST-0002', { subtotal: 1000, discount: 100, total: 901 }), 'CHECK constraint failed');
  assert.doesNotThrow(() => newPo('PO-TEST-0003', { subtotal: 1000, discount: 100, other: 50, shipping: 20, total: 870 }));
  const poId = newPo('PO-TEST-0004');
  refuses(() => db.run(
    `INSERT INTO POLine (PurchaseOrderId, ItemId, Quantity, UnitPriceCentavos, LineTotalCentavos) VALUES (@poId, @itemId, 2, 500, 999)`,
    { poId, itemId: itemId('HDPE-001') }
  ), 'CHECK constraint failed');
});

test('a PR put on hold or cancelled needs a reason', () => {
  refuses(() => newPr('PR-TEST-0001', 'on_hold'), 'CHECK constraint failed');
  refuses(() => newPr('PR-TEST-0002', 'cancelled', '   '), 'CHECK constraint failed');
  assert.doesNotThrow(() => newPr('PR-TEST-0003', 'on_hold', 'Price too high'));
  assert.doesNotThrow(() => newPr('PR-TEST-0004', 'cancelled', 'No longer needed'));
  assert.doesNotThrow(() => newPr('PR-TEST-0005', 'approved'));
});

test('status lists are fixed', () => {
  refuses(() => newPr('PR-TEST-0006', 'returned', 'x'), 'CHECK constraint failed');
  refuses(() => db.run(
    `INSERT INTO PurchaseOrder (PoNumber, SupplierId, ProjectId, CreatedBy, Status) VALUES ('PO-TEST-0005', @supplierId, @projectId, @userId, 'delivered')`,
    { supplierId, projectId, userId }
  ), 'CHECK constraint failed');
});

test('PR lines: supplier and price go together, and an item appears once per PR', () => {
  const prId = newPr('PR-TEST-0007');
  const add = (item, extra = {}) => db.run(
    `INSERT INTO PRLine (PurchaseRequisitionId, ItemId, ShortQty, SupplierId, UnitPriceCentavos) VALUES (@prId, @itemId, 2, @sup, @price)`,
    { prId, itemId: itemId(item), sup: null, price: null, ...extra }
  );
  assert.doesNotThrow(() => add('ACU-001'));
  assert.doesNotThrow(() => add('HDPE-001', { sup: supplierId, price: 53266 }));
  refuses(() => add('HDPE-002', { sup: supplierId }), 'CHECK constraint failed');
  refuses(() => add('HDPE-002', { price: 100 }), 'CHECK constraint failed');
  refuses(() => add('ACU-001'), 'UNIQUE constraint failed');
});

test('one quotation per supplier for each PR line', () => {
  const prId = newPr('PR-TEST-0008');
  const lineId = db.run(
    `INSERT INTO PRLine (PurchaseRequisitionId, ItemId, ShortQty) VALUES (@prId, @itemId, 1)`, { prId, itemId: itemId('ACU-001') }
  ).lastId;
  const quote = () => db.run(
    `INSERT INTO Quotation (PrLineId, SupplierId, UnitPriceCentavos) VALUES (@lineId, @supplierId, 450000)`, { lineId, supplierId }
  );
  assert.doesNotThrow(quote);
  refuses(quote, 'UNIQUE constraint failed');
});

test('document numbers are unique and links must point at real rows', () => {
  newPr('PR-TEST-0009');
  refuses(() => newPr('PR-TEST-0009'), 'UNIQUE constraint failed');
  refuses(() => newPo('PO-TEST-0001'), 'UNIQUE constraint failed');
  refuses(() => newPo('PO-TEST-0006', { projectId: 999999 }), 'FOREIGN KEY constraint failed');
});
