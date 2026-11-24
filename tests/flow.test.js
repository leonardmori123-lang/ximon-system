// The whole story through the web API, the same calls the pages make.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, start, stop, loginAs, call, rfBody } = require('./helpers');

test.before(async () => {
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role) VALUES ('Other Foreman', 'foreman2', @hash, 'foreman')`,
    { hash: bcrypt.hashSync('secret123', 4) });
  await start();
});
test.after(stop);

const json = async (res, status) => { assert.strictEqual(res.status, status, await res.clone().text()); return res.json(); };

test('file, return, revise, return again, cancel: the foreman can revise only once', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');

  const { id, rfNumber } = await json(await call('POST', '/api/requisitions', foreman, rfBody([['HDPE-001', 2], ['ACU-001', 1]])), 201);
  assert.match(rfNumber, /^RF-\d{4}-\d{4}$/);
  assert.strictEqual((await json(await call('GET', `/api/requisitions?status=pending`, owner), 200)).length, 1);

  await json(await call('POST', `/api/requisitions/${id}/return`, owner, { reason: '' }), 400);
  await json(await call('POST', `/api/requisitions/${id}/return`, owner, { reason: 'Wrong project' }), 200);
  assert.strictEqual((await json(await call('GET', `/api/requisitions/${id}`, foreman), 200)).canRevise, true);

  await json(await call('PUT', `/api/requisitions/${id}`, foreman, rfBody([['HDPE-001', 1]])), 200);
  let rf = await json(await call('GET', `/api/requisitions/${id}`, foreman), 200);
  assert.deepStrictEqual([rf.Status, rf.RevisionCount, rf.lines.length], ['pending', 1, 1]);

  await json(await call('POST', `/api/requisitions/${id}/return`, owner, { reason: 'Still wrong' }), 200);
  rf = await json(await call('GET', `/api/requisitions/${id}`, foreman), 200);
  assert.strictEqual(rf.canRevise, false);
  await json(await call('PUT', `/api/requisitions/${id}`, foreman, rfBody([['HDPE-001', 1]])), 409);

  await json(await call('POST', `/api/requisitions/${id}/cancel`, foreman, {}), 200);
  rf = await json(await call('GET', `/api/requisitions/${id}`, owner), 200);
  assert.strictEqual(rf.Status, 'cancelled');
  assert.deepStrictEqual(rf.history.map((h) => h.ToStatus), ['pending', 'returned', 'pending', 'returned', 'cancelled']);
  await json(await call('POST', `/api/requisitions/${id}/cancel`, foreman, {}), 409);
});

test('approve with a shortage, release, confirm: items, lines and statuses line up', async () => {
  const foreman = await loginAs('foreman1');
  const owner = await loginAs('owner1');
  const custodian = await loginAs('custodian1');

  const { id } = await json(await call('POST', '/api/requisitions', foreman, rfBody([['HDPE-001', 3], ['ACU-001', 1]])), 201);
  const approved = await json(await call('POST', `/api/requisitions/${id}/approve`, owner), 200);
  assert.strictEqual(approved.shortLines, 1);

  let rf = await json(await call('GET', `/api/requisitions/${id}`, owner), 200);
  const hdpe = rf.lines.find((l) => l.Code === 'HDPE-001');
  const pump = rf.lines.find((l) => l.Code === 'ACU-001');
  assert.deepStrictEqual([hdpe.QtyReserved, hdpe.QtyShort, pump.QtyReserved, pump.QtyShort], [3, 0, 0, 1]);

  const items = await json(await call('GET', '/api/items', custodian), 200);
  const itemRow = items.find((i) => i.Code === 'HDPE-001');
  assert.deepStrictEqual([itemRow.OnHand, itemRow.Reserved, itemRow.Available], [10, 3, 7]);

  const ready = await json(await call('GET', '/api/slips/releasable', custodian), 200);
  assert.deepStrictEqual(ready.filter((r) => r.RequisitionId === id).map((r) => r.LinesToRelease), [1]);

  const { id: slipId } = await json(await call('POST', '/api/slips', custodian, { requisitionId: id }), 201);
  await json(await call('POST', `/api/slips/${slipId}/release`, custodian), 200);
  assert.strictEqual((await json(await call('GET', '/api/slips?status=released', foreman), 200)).length, 1);
  await json(await call('POST', `/api/slips/${slipId}/acknowledge`, foreman, { remarks: 'Received 3 pcs' }), 200);

  rf = await json(await call('GET', `/api/requisitions/${id}`, foreman), 200);
  assert.strictEqual(rf.Status, 'partly_fulfilled'); // the pump is still short
  assert.strictEqual(rf.slips.length, 1);
  const after = (await json(await call('GET', '/api/items', custodian), 200)).find((i) => i.Code === 'HDPE-001');
  assert.deepStrictEqual([after.OnHand, after.Reserved, after.Available], [7, 0, 7]);
});

test('a foreman sees only his own requisitions and slips', async () => {
  const one = await loginAs('foreman1');
  const two = await loginAs('foreman2');
  const owner = await loginAs('owner1');
  const { id } = await json(await call('POST', '/api/requisitions', one, rfBody([['HDPE-002', 1]])), 201);

  assert.strictEqual((await json(await call('GET', '/api/requisitions', two), 200)).length, 0);
  await json(await call('GET', `/api/requisitions/${id}`, two), 403);
  await json(await call('POST', `/api/requisitions/${id}/cancel`, two, {}), 403);
  assert.ok((await json(await call('GET', '/api/requisitions', owner), 200)).some((r) => r.RequisitionId === id));
});

test('requisition rules: past date, duplicate item, missing item are refused', async () => {
  const foreman = await loginAs('foreman1');
  const good = rfBody([['HDPE-001', 1]]);
  await json(await call('POST', '/api/requisitions', foreman, { ...good, dateNeeded: '2020-01-01' }), 400);
  await json(await call('POST', '/api/requisitions', foreman, rfBody([['HDPE-001', 1], ['HDPE-001', 2]])), 400);
  await json(await call('POST', '/api/requisitions', foreman, { ...good, lines: [{ itemId: 9999, quantity: 1 }] }), 400);
  await json(await call('POST', '/api/requisitions', foreman, { ...good, lines: [{ itemId: good.lines[0].itemId, quantity: 0 }] }), 400);
});
