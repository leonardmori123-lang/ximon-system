// Stress test. Many random operations in a random order (file, approve, return, revise, cancel, slips,
// deliveries, adjustments, purchase requisitions, purchase orders), and after EVERY step the stock and
// document rules must still hold. The random numbers are seeded, so a failure can be repeated: the message
// says the seed, the step and the last operations.
const test = require('node:test');
const assert = require('node:assert');
const { db, user, itemId, rfBody } = require('./helpers');
const rf = require('../server/services/requisitions');
const slips = require('../server/services/issuance');
const { receiveStock, allocateToRequisition } = require('../server/services/receipts');
const { adjustStock } = require('../server/services/adjustments');
const pu = require('../server/services/purchasing');
const { recordPoReceipt } = require('../server/services/poReceipts');

const foreman = user('foreman1'), owner = user('owner1'), custodian = user('custodian1');
const purchaser = user('purchaser1'), verifier = user('verifier1');
const CODES = ['HDPE-001', 'HDPE-002', 'HDPE-003', 'HDPE-004', 'HDPE-005', 'HDPE-006', 'ACU-001'];
const EPS = 0.005;

function makeRandom(seed) { // mulberry32: small seeded random numbers
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- the rules that must hold after every step ----
function checkRules() {
  const problems = [];
  const bad = (text) => problems.push(text);

  for (const r of db.all(`SELECT i.Code, i.OnHand, i.Reserved,
        ROUND(COALESCE((SELECT SUM(t.Quantity) FROM StockTransaction t WHERE t.ItemId = i.ItemId), 0), 2) AS Logged,
        ROUND(COALESCE((SELECT SUM(l.QtyReserved - l.QtyIssued) FROM RequisitionLine l WHERE l.ItemId = i.ItemId), 0), 2) AS Promised
      FROM Item i`)) {
    if (r.Reserved > r.OnHand + EPS || r.Reserved < -EPS) bad(`${r.Code}: reserved ${r.Reserved} vs on hand ${r.OnHand}`);
    if (Math.abs(r.Logged - r.OnHand) > EPS) bad(`${r.Code}: stock log adds up to ${r.Logged} but on hand is ${r.OnHand}`);
    if (Math.abs(r.Promised - r.Reserved) > EPS) bad(`${r.Code}: requisition lines promise ${r.Promised} but reserved is ${r.Reserved}`);
  }

  const byRf = new Map();
  for (const l of db.all(`SELECT l.LineId, l.RequisitionId, r.RfNumber, r.Status, l.Quantity, l.QtyReserved, l.QtyShort, l.QtyIssued
                          FROM RequisitionLine l JOIN Requisition r ON r.RequisitionId = l.RequisitionId`)) {
    (byRf.get(l.RequisitionId) || byRf.set(l.RequisitionId, []).get(l.RequisitionId)).push(l);
    const tag = `${l.RfNumber} line ${l.LineId} (${l.Status})`;
    if (['pending', 'returned', 'cancelled'].includes(l.Status) && (l.QtyReserved || l.QtyShort || l.QtyIssued)) bad(`${tag}: a ${l.Status} RF still holds reserved ${l.QtyReserved} short ${l.QtyShort} issued ${l.QtyIssued}`);
    if (['approved', 'partly_fulfilled', 'fulfilled'].includes(l.Status)) {
      if (Math.abs(l.QtyReserved + l.QtyShort - l.Quantity) > EPS) bad(`${tag}: reserved ${l.QtyReserved} + short ${l.QtyShort} is not quantity ${l.Quantity}`);
      if (l.QtyIssued > l.QtyReserved + EPS) bad(`${tag}: issued ${l.QtyIssued} is more than reserved ${l.QtyReserved}`);
      if (l.QtyShort < -EPS) bad(`${tag}: negative shortage`);
    }
  }
  for (const [, lines] of byRf) {
    const st = lines[0].Status;
    const allIssued = lines.every((l) => Math.abs(l.QtyIssued - l.Quantity) <= EPS);
    const anyIssued = lines.some((l) => l.QtyIssued > EPS);
    if (st === 'fulfilled' && !allIssued) bad(`${lines[0].RfNumber}: fulfilled but not everything was issued`);
    if (st === 'partly_fulfilled' && (!anyIssued || allIssued)) bad(`${lines[0].RfNumber}: partly fulfilled but issued does not match`);
    if (st === 'approved' && anyIssued) bad(`${lines[0].RfNumber}: approved but something was already issued`);
    if (allIssued && !['fulfilled', 'cancelled'].includes(st) && lines.length) bad(`${lines[0].RfNumber}: everything issued but status is ${st}`);
  }

  for (const r of db.all(`SELECT RequisitionId, COUNT(*) AS n FROM IssuanceSlip WHERE Status IN ('prepared','released') GROUP BY RequisitionId HAVING n > 1`)) bad(`RF id ${r.RequisitionId} has ${r.n} open slips`);
  for (const r of db.all(`SELECT il.RequisitionLineId AS id, ROUND(SUM(il.Quantity), 2) AS onSlips, ROUND(l.QtyReserved - l.QtyIssued, 2) AS room
                          FROM IssuanceLine il JOIN IssuanceSlip s ON s.SlipId = il.SlipId JOIN RequisitionLine l ON l.LineId = il.RequisitionLineId
                          WHERE s.Status IN ('prepared','released') GROUP BY il.RequisitionLineId`)) {
    if (r.onSlips > r.room + EPS) bad(`line ${r.id}: open slips carry ${r.onSlips} but only ${r.room} is reserved and not issued`);
  }
  for (const s of db.all(`SELECT s.SlipNumber, s.Status, r.Status AS RfStatus FROM IssuanceSlip s JOIN Requisition r ON r.RequisitionId = s.RequisitionId
                          WHERE s.Status IN ('prepared','released') AND r.Status NOT IN ('approved','partly_fulfilled')`)) bad(`${s.SlipNumber} is ${s.Status} but its RF is ${s.RfStatus}`);

  for (const po of db.all(`SELECT po.PoNumber, pr.Status AS PrStatus FROM PurchaseOrder po
                           JOIN PurchaseRequisition pr ON pr.PurchaseRequisitionId = po.PurchaseRequisitionId`)) {
    if (po.PrStatus !== 'approved') bad(`${po.PoNumber}: its purchase requisition is ${po.PrStatus}`);
  }
  for (const po of db.all('SELECT PurchaseOrderId, PoNumber, Status FROM PurchaseOrder')) {
    const lines = db.all('SELECT Quantity, QtyReceived FROM POLine WHERE PurchaseOrderId = @id', { id: po.PurchaseOrderId });
    const all = lines.every((l) => Math.abs(l.QtyReceived - l.Quantity) <= EPS);
    const some = lines.some((l) => l.QtyReceived > EPS);
    if (lines.some((l) => l.QtyReceived > l.Quantity + EPS)) bad(`${po.PoNumber}: received more than ordered`);
    const expected = all ? 'closed' : some ? 'partly_delivered' : 'open';
    if (po.Status !== expected) bad(`${po.PoNumber}: status ${po.Status} but the lines say ${expected}`);
  }
  assert.deepStrictEqual(db.all('PRAGMA foreign_key_check'), [], 'foreign keys');
  return problems;
}

// ---- the random operations ----
function run(seed, steps) {
  const rnd = makeRandom(seed);
  const pick = (rows) => (rows.length ? rows[Math.floor(rnd() * rows.length)] : undefined);
  const chance = (p) => rnd() < p;
  const log = [];
  const suppliers = [pu.createSupplier({ name: `Fuzz A ${seed}` }).id, pu.createSupplier({ name: `Fuzz B ${seed}` }).id];
  let reportNo = 0;

  const randomLines = () => {
    const n = 1 + Math.floor(rnd() * 3);
    const codes = [...CODES].sort(() => rnd() - 0.5).slice(0, n);
    return codes.map((c) => [c, pick([1, 2, 3, 4, 5, 6, 0.5, 2.5])]);
  };
  const rfs = (where, params) => db.all(`SELECT RequisitionId AS id, RevisionCount FROM Requisition WHERE ${where}`, params);

  const ops = [
    [6, 'file', () => rf.createRequisition(foreman, rfBody(randomLines()))],
    [5, 'approve', () => { const r = pick(rfs(`Status = 'pending'`)); if (r) rf.approveRequisition(owner, r.id); }],
    [2, 'return', () => { const r = pick(rfs(`Status = 'pending'`)); if (r) rf.returnRequisition(owner, r.id, 'check it'); }],
    [2, 'revise', () => { const r = pick(rfs(`Status = 'returned' AND RevisionCount = 0`)); if (r) rf.reviseRequisition(foreman, r.id, rfBody(randomLines())); }],
    [1, 'cancel pending/returned', () => { const r = pick(rfs(`Status IN ('pending','returned')`)); if (r) rf.cancelRequisition(foreman, r.id, ''); }],
    [2, 'cancel approved', () => { const r = pick(rfs(`Status = 'approved'`)); if (r) rf.cancelApprovedRequisition(owner, r.id, 'not needed'); }],
    [1, 'try to cancel partly fulfilled', () => { const r = pick(rfs(`Status IN ('partly_fulfilled','fulfilled')`)); if (r) rf.cancelApprovedRequisition(owner, r.id, 'too late'); }],
    [5, 'prepare slip', () => { const r = pick(rfs(`Status IN ('approved','partly_fulfilled')`)); if (r) slips.prepareSlip(custodian, r.id); }],
    [4, 'release slip', () => { const s = pick(db.all(`SELECT SlipId AS id FROM IssuanceSlip WHERE Status = 'prepared'`)); if (s) slips.releaseSlip(custodian, s.id); }],
    [1, 'cancel slip', () => { const s = pick(db.all(`SELECT SlipId AS id FROM IssuanceSlip WHERE Status = 'prepared'`)); if (s) slips.cancelSlip(custodian, s.id); }],
    [4, 'confirm slip', () => { const s = pick(db.all(`SELECT s.SlipId AS id FROM IssuanceSlip s WHERE s.Status = 'released'`)); if (s) slips.acknowledgeSlip(foreman, s.id, ''); }],
    [3, 'adjust stock', () => { adjustStock({ itemId: itemId(pick(CODES)), counted: pick([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 2.5]), reason: 'count', userId: custodian.id }); }],
    [3, 'deliver for an RF', () => {
      const l = pick(db.all(`SELECT l.RequisitionId AS rid, l.ItemId, l.QtyShort FROM RequisitionLine l JOIN Requisition r ON r.RequisitionId = l.RequisitionId
                             WHERE r.Status IN ('approved','partly_fulfilled') AND l.QtyShort > 0`));
      if (!l) return;
      const quantity = chance(0.3) ? l.QtyShort + 1 : Math.max(0.5, Math.min(l.QtyShort, pick([1, 2, 0.5, l.QtyShort])));
      db.transaction(() => {
        receiveStock({ itemId: l.ItemId, quantity, sourceDocument: { type: 'RR', id: ++reportNo, number: `RR-F-${reportNo}` }, userId: verifier.id });
        allocateToRequisition({ requisitionId: l.rid, lines: [{ itemId: l.ItemId, quantity }], userId: verifier.id });
      });
    }],
    [1, 'free receipt', () => receiveStock({ itemId: itemId(pick(CODES)), quantity: pick([1, 2, 3]), sourceDocument: { type: 'RR', id: ++reportNo, number: `RR-F-${reportNo}` }, userId: verifier.id })],
    [4, 'price a PR', () => {
      const pr = pick(db.all(`SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE Status IN ('pending','on_hold')`));
      if (!pr) return;
      const lines = db.all('SELECT PrLineId FROM PRLine WHERE PurchaseRequisitionId = @id', { id: pr.id })
        .map((l) => ({ prLineId: l.PrLineId, unitPriceCentavos: 100 + Math.floor(rnd() * 600000) }));
      pu.savePrices(purchaser, pr.id, { supplierId: pick(suppliers), lines });
    }],
    [4, 'owner decides a PR', () => {
      const pr = pick(db.all(`SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE Status = 'pending'
                              AND NOT EXISTS (SELECT 1 FROM PRLine l WHERE l.PurchaseRequisitionId = PurchaseRequisition.PurchaseRequisitionId AND l.UnitPriceCentavos IS NULL)`));
      if (!pr) return;
      const action = pick(['approve', 'approve', 'approve', 'hold', 'cancel']);
      pu.decidePr(owner, pr.id, action, { reason: 'because', note: 'ok' });
    }],
    [4, 'make a PO', () => { const pr = pick(db.all(`SELECT PurchaseRequisitionId AS id FROM PurchaseRequisition WHERE Status = 'approved'`)); if (pr) pu.createPo(purchaser, pr.id, { discountPercent: pick([0, 10, 58, 12.5]) }); }],
    [5, 'deliver a PO (the way Delivery will)', () => {
      const po = pick(db.all(`SELECT PurchaseOrderId AS id FROM PurchaseOrder WHERE Status IN ('open','partly_delivered')`));
      if (!po) return;
      const open = db.all('SELECT PoLineId, Quantity, QtyReceived FROM POLine WHERE PurchaseOrderId = @id AND QtyReceived < Quantity', { id: po.id });
      const lines = open.filter(() => chance(0.7)).map((l) => {
        const out = Math.round((l.Quantity - l.QtyReceived) * 100) / 100;
        return { poLineId: l.PoLineId, quantity: chance(0.5) ? out : Math.max(0.5, Math.min(out, pick([1, 2, 0.5]))) };
      });
      if (!lines.length) return;
      db.transaction(() => {
        const got = recordPoReceipt({ poId: po.id, lines, userId: verifier.id, reportNumber: `RR-P-${++reportNo}` });
        for (const l of got.lines) receiveStock({ itemId: l.itemId, quantity: l.quantity, sourceDocument: { type: 'RR', id: reportNo, number: `RR-P-${reportNo}` }, projectId: got.projectId, userId: verifier.id });
        if (got.requisitionId) allocateToRequisition({ requisitionId: got.requisitionId, lines: got.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })), userId: verifier.id });
      });
    }],
  ];
  const bag = ops.flatMap(([w, name, fn]) => Array(w).fill([name, fn]));

  // some starting stock, recorded the proper way
  for (const code of CODES) {
    try { adjustStock({ itemId: itemId(code), counted: Math.floor(rnd() * 8), reason: 'Opening count', userId: custodian.id }); } catch (err) {
      if (!(err && typeof err.status === 'number' && err.status < 500)) throw err; // same count or below reserved: just keep the stock as it is
    }
  }

  const refused = {};
  for (let step = 1; step <= steps; step++) {
    const [name, fn] = pick(bag);
    try { fn(); log.push(name); } catch (err) {
      if (err && typeof err.status === 'number' && err.status < 500) { refused[name] = (refused[name] || 0) + 1; log.push(`${name} (refused: ${err.message.slice(0, 60)})`); }
      else assert.fail(`seed ${seed} step ${step}: "${name}" crashed with a non-HttpError: ${err && err.stack}\nlast operations: ${log.slice(-12).join(' | ')}`);
    }
    const problems = checkRules();
    if (problems.length) assert.fail(`seed ${seed} step ${step} after "${name}": ${problems.slice(0, 5).join('; ')}\nlast operations: ${log.slice(-12).join(' | ')}`);
  }
  return refused;
}

for (const seed of [1, 7, 42, 2026, 31337]) {
  test(`stress: ${400} random operations in a random order keep every stock and document rule (seed ${seed})`, () => {
    run(seed, 400);
  });
}

test('the stress test really exercises the chain (every kind of document was made)', () => {
  const n = (sql) => db.get(sql).n;
  assert.ok(n('SELECT COUNT(*) AS n FROM Requisition') > 100);
  assert.ok(n(`SELECT COUNT(*) AS n FROM Requisition WHERE Status = 'fulfilled'`) > 0, 'some RFs were closed');
  assert.ok(n(`SELECT COUNT(*) AS n FROM Requisition WHERE Status = 'cancelled'`) > 0);
  assert.ok(n('SELECT COUNT(*) AS n FROM IssuanceSlip') > 10);
  assert.ok(n('SELECT COUNT(*) AS n FROM PurchaseRequisition') > 10);
  assert.ok(n('SELECT COUNT(*) AS n FROM PurchaseOrder') > 0, 'some purchase orders were made');
  assert.ok(n(`SELECT COUNT(*) AS n FROM StockTransaction WHERE TxType = 'receipt'`) > 0);
  assert.ok(n(`SELECT COUNT(*) AS n FROM StockTransaction WHERE TxType = 'adjustment'`) > 0);
  console.log('  documents made:', JSON.stringify({
    rfs: n('SELECT COUNT(*) AS n FROM Requisition'), fulfilled: n(`SELECT COUNT(*) AS n FROM Requisition WHERE Status='fulfilled'`),
    slips: n('SELECT COUNT(*) AS n FROM IssuanceSlip'), prs: n('SELECT COUNT(*) AS n FROM PurchaseRequisition'),
    pos: n('SELECT COUNT(*) AS n FROM PurchaseOrder'), closedPos: n(`SELECT COUNT(*) AS n FROM PurchaseOrder WHERE Status='closed'`),
  }));
});
