// Who may do what, and what happens with bad input.
const test = require('node:test');
const assert = require('node:assert');
const { start, stop, call, callRaw, loginAs } = require('./helpers');

test.before(start);
test.after(stop);

test('nobody logged in gets 401 on every module route', async () => {
  for (const [method, url] of [['GET', '/api/items'], ['POST', '/api/items'], ['GET', '/api/requisitions'],
    ['POST', '/api/requisitions'], ['POST', '/api/requisitions/1/approve'], ['GET', '/api/projects']]) {
    assert.strictEqual((await call(method, url)).status, 401, `${method} ${url}`);
  }
});

test('only the owner can approve or return a requisition', async () => {
  for (const who of ['foreman1', 'purchaser1', 'custodian1']) {
    const c = await loginAs(who);
    assert.strictEqual((await call('POST', '/api/requisitions/1/approve', c)).status, 403, who);
    assert.strictEqual((await call('POST', '/api/requisitions/1/return', c, { reason: 'x' })).status, 403, who);
  }
});

test('only the foreman can file, revise or cancel a requisition', async () => {
  const owner = await loginAs('owner1');
  assert.strictEqual((await call('POST', '/api/requisitions', owner, {})).status, 403);
  assert.strictEqual((await call('PUT', '/api/requisitions/1', owner, {})).status, 403);
  assert.strictEqual((await call('POST', '/api/requisitions/1/cancel', owner, {})).status, 403);
});

test('purchaser cannot read requisitions yet', async () => {
  assert.strictEqual((await call('GET', '/api/requisitions', await loginAs('purchaser1'))).status, 403);
});

test('only owner and custodian can add or edit items', async () => {
  const foreman = await loginAs('foreman1');
  assert.strictEqual((await call('POST', '/api/items', foreman, {})).status, 403);
  assert.strictEqual((await call('PUT', '/api/items/1', foreman, {})).status, 403);
  const res = await call('POST', '/api/items', await loginAs('custodian1'), {});
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Item code/);
});

test('items: add, duplicate code, edit, deactivate', async () => {
  const c = await loginAs('custodian1');
  const body = { code: 'tst-1', description: 'Test item', unit: 'pc', location: 'Shelf 1', reorderPoint: 2, leadTimeDays: 5 };
  const made = await call('POST', '/api/items', c, body);
  assert.strictEqual(made.status, 201);
  const { id } = await made.json();
  assert.strictEqual((await call('POST', '/api/items', c, body)).status, 409);

  assert.strictEqual((await call('PUT', `/api/items/${id}`, c, { ...body, description: 'Renamed', isActive: false })).status, 200);
  const all = await (await call('GET', '/api/items?all=1', c)).json();
  const row = all.find((i) => i.Code === 'TST-1');
  assert.strictEqual(row.Description, 'Renamed');
  assert.strictEqual(row.IsActive, 0);
  const visible = await (await call('GET', '/api/items', await loginAs('foreman1'))).json();
  assert.ok(!visible.some((i) => i.Code === 'TST-1'), 'inactive items are hidden from requesters');
  assert.strictEqual((await call('PUT', '/api/items/9999', c, body)).status, 404);
});

test('a foreman filing an empty requisition gets a plain 400 message', async () => {
  const res = await call('POST', '/api/requisitions', await loginAs('foreman1'), {});
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /project/i);
});

test('bad ids and broken JSON are 400s, not crashes', async () => {
  const owner = await loginAs('owner1');
  assert.strictEqual((await call('GET', '/api/requisitions/abc', owner)).status, 400);
  const res = await callRaw('POST', '/api/requisitions', await loginAs('foreman1'), '{oops');
  assert.strictEqual(res.status, 400);
});
