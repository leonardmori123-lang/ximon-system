// Purchasing, build steps 1 to 3: the purchase requisition made from an RF shortage, suppliers and
// their prices, and pricing a purchase requisition. Real database, real server.
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
    ['GET', '/api/purchasing/prs/1'], ['PUT', '/api/purchasing/prs/1/prices']]) {
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
  const owner = user('owner1');
  const detail = await json(await call('GET', `/api/purchasing/prs/${prId}`, purchaser), 200);
  const body = { supplierId: supplierId(), lines: [{ prLineId: detail.lines[0].PrLineId, unitPriceCentavos: 99900 }] };
  const path = `/api/purchasing/prs/${prId}/prices`;

  // The owner's hold button belongs to the next build step, so put the PR on hold the way that step will.
  db.run(`UPDATE PurchaseRequisition SET Status = 'on_hold', Reason = 'Price too high', DecidedBy = @by, DecidedAt = datetime('now','localtime')
          WHERE PurchaseRequisitionId = @prId`, { by: owner.id, prId });
  db.run(`INSERT INTO StatusHistory (DocType, DocId, FromStatus, ToStatus, ChangedBy, Reason) VALUES ('PR', @prId, 'pending', 'on_hold', @by, 'Price too high')`,
    { by: owner.id, prId });
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
