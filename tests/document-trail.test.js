// Document Trail: an RF's PRs and their POs; rows are inserted directly because the screens are not built yet.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, start, stop, loginAs, call, user, projectId, rfBody } = require('./helpers');

test.before(async () => {
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role) VALUES ('Other Foreman', 'foreman2', @hash, 'foreman')`,
    { hash: bcrypt.hashSync('secret123', 4) });
  await start();
});
test.after(stop);

const json = async (res, status) => { assert.strictEqual(res.status, status, await res.clone().text()); return res.json(); };

async function fileRf() {
  const foreman = await loginAs('foreman1');
  const { id } = await json(await call('POST', '/api/requisitions', foreman, rfBody([['HDPE-002', 1]])), 201);
  return id;
}

async function readRf(username, id) {
  return json(await call('GET', `/api/requisitions/${id}`, await loginAs(username)), 200);
}

function addPr(requisitionId, prNumber, status = 'pending') {
  return db.run(
    `INSERT INTO PurchaseRequisition (PrNumber, RequisitionId, ProjectId, Status, Reason)
     VALUES (@prNumber, @requisitionId, @projectId, @status, 'Test reason')`,
    { prNumber, requisitionId, projectId: projectId(), status }
  ).lastId;
}

// Test POs carry 500000 + 12345 = 512345 centavos, so tests can check money stays off the page.
function addPo(purchaseRequisitionId, poNumber, status = 'open') {
  return db.run(
    `INSERT INTO PurchaseOrder (PoNumber, PurchaseRequisitionId, SupplierId, ProjectId, Status, CreatedBy,
                                SubtotalCentavos, ShippingCentavos, TotalCentavos)
     VALUES (@poNumber, @purchaseRequisitionId, (SELECT SupplierId FROM Supplier LIMIT 1), @projectId, @status, @userId,
             500000, 12345, 512345)`,
    { poNumber, purchaseRequisitionId, projectId: projectId(), status, userId: user('purchaser1').id }
  ).lastId;
}

test('an RF with no PR has an empty trail and still loads normally', async () => {
  const id = await fileRf();
  const rf = await readRf('foreman1', id);
  assert.deepStrictEqual(rf.purchaseRequisitions, []);
  assert.deepStrictEqual(rf.purchaseOrders, []);
  assert.strictEqual(rf.lines.length, 1);
  assert.strictEqual(rf.history.length, 1);
});

test('a PR shows its number and status, even when it has no PO yet', async () => {
  const id = await fileRf();
  addPr(id, 'PR-TEST-0001', 'approved');
  const rf = await readRf('foreman1', id);
  assert.deepStrictEqual(rf.purchaseRequisitions, [{ PrNumber: 'PR-TEST-0001', Status: 'approved' }]);
  assert.deepStrictEqual(rf.purchaseOrders, []);
});

test('a PO shows up through its PR, and only through its PR', async () => {
  const id = await fileRf();
  const otherId = await fileRf();
  const pr = addPr(id, 'PR-TEST-0002');
  const otherPr = addPr(otherId, 'PR-TEST-0003');
  addPo(pr, 'PO-TEST-0001', 'partly_delivered');
  addPo(otherPr, 'PO-TEST-0002'); // belongs to the other RF
  addPo(null, 'PO-TEST-0003'); // not linked to any PR

  const rf = await readRf('foreman1', id);
  assert.deepStrictEqual(rf.purchaseOrders, [{ PoNumber: 'PO-TEST-0001', Status: 'partly_delivered' }]);
});

test('an RF with several PRs and POs shows all of them, in the order they were made', async () => {
  const id = await fileRf();
  // POs are made in a different order from PRs, so PO order follows when they were made.
  const firstPr = addPr(id, 'PR-TEST-0004', 'approved');
  addPr(id, 'PR-TEST-0005', 'on_hold'); // no PO yet
  const thirdPr = addPr(id, 'PR-TEST-0010', 'approved');
  const fourthPr = addPr(id, 'PR-TEST-0011', 'approved');
  addPo(thirdPr, 'PO-TEST-0004', 'closed');
  addPo(firstPr, 'PO-TEST-0005', 'open');
  addPo(fourthPr, 'PO-TEST-0006', 'open');

  const rf = await readRf('owner1', id);
  assert.deepStrictEqual(rf.purchaseRequisitions, [
    { PrNumber: 'PR-TEST-0004', Status: 'approved' },
    { PrNumber: 'PR-TEST-0005', Status: 'on_hold' },
    { PrNumber: 'PR-TEST-0010', Status: 'approved' },
    { PrNumber: 'PR-TEST-0011', Status: 'approved' },
  ]);
  assert.deepStrictEqual(rf.purchaseOrders, [
    { PoNumber: 'PO-TEST-0004', Status: 'closed' },
    { PoNumber: 'PO-TEST-0005', Status: 'open' },
    { PoNumber: 'PO-TEST-0006', Status: 'open' },
  ]);
});

test('the trail carries only number and status, never prices or totals', async () => {
  const id = await fileRf();
  addPo(addPr(id, 'PR-TEST-0007', 'approved'), 'PO-TEST-0007');

  for (const who of ['foreman1', 'owner1']) {
    const rf = await readRf(who, id);
    assert.deepStrictEqual(Object.keys(rf.purchaseRequisitions[0]), ['PrNumber', 'Status'], who);
    assert.deepStrictEqual(Object.keys(rf.purchaseOrders[0]), ['PoNumber', 'Status'], who);

    const wholeResponse = JSON.stringify(rf);
    assert.ok(!/centavo/i.test(wholeResponse), `${who} got a money field`);
    assert.ok(!wholeResponse.includes('512345') && !wholeResponse.includes('500000'), `${who} got a money value`);
  }
});

test('the issuance slips still show next to the trail', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const custodian = await loginAs('custodian1');

  const { id } = await json(await call('POST', '/api/requisitions', foreman, rfBody([['HDPE-001', 1]])), 201);
  await json(await call('POST', `/api/requisitions/${id}/approve`, owner), 200);
  await json(await call('POST', '/api/slips', custodian, { requisitionId: id }), 201);
  addPr(id, 'PR-TEST-0008', 'approved');

  const rf = await readRf('foreman1', id);
  assert.strictEqual(rf.slips.length, 1);
  assert.match(rf.slips[0].SlipNumber, /^IS-\d{4}-\d{4}$/);
  assert.strictEqual(rf.purchaseRequisitions.length, 1);
});

test('another foreman cannot open the RF, so the trail stays private too', async () => {
  const id = await fileRf();
  addPo(addPr(id, 'PR-TEST-0009'), 'PO-TEST-0009');
  await json(await call('GET', `/api/requisitions/${id}`, await loginAs('foreman2')), 403);
  await json(await call('GET', `/api/requisitions/${id}`, await loginAs('purchaser1')), 403);
});
