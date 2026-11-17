// Role protection and input checks on the real routes, with the database replaced by a fake.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');

const dbPath = require.resolve('../server/db');
const hash = bcrypt.hashSync('secret123', 4);
const USERS = {
  owner1: { UserId: 1, FullName: 'Owner', Role: 'owner' },
  foreman1: { UserId: 2, FullName: 'Foreman', Role: 'foreman' },
  custodian1: { UserId: 3, FullName: 'Custodian', Role: 'custodian' },
  purchaser1: { UserId: 4, FullName: 'Purchaser', Role: 'purchaser' },
};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    sql: {}, makeConfig: () => ({}),
    withTransaction: async () => { throw new Error('database should not be reached in these tests'); },
    query: async (text, params) => {
      if (text.includes('FROM AppUser') && USERS[params.username]) return [{ ...USERS[params.username], PasswordHash: hash }];
      return [];
    },
  },
};
const app = require('../server/index');

let server, base;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

async function loginAs(username) {
  const res = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  assert.strictEqual(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
const call = (method, url, cookie, body) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('nobody logged in gets 401 on every module route', async () => {
  for (const [method, url] of [['GET', '/api/items'], ['POST', '/api/items'], ['GET', '/api/requisitions'],
    ['POST', '/api/requisitions'], ['POST', '/api/requisitions/1/approve'], ['GET', '/api/projects']]) {
    assert.strictEqual((await call(method, url)).status, 401, `${method} ${url}`);
  }
});

test('only the owner can approve or return a requisition', async () => {
  const foreman = await loginAs('foreman1');
  assert.strictEqual((await call('POST', '/api/requisitions/1/approve', foreman)).status, 403);
  assert.strictEqual((await call('POST', '/api/requisitions/1/return', foreman, { reason: 'x' })).status, 403);
  const purchaser = await loginAs('purchaser1');
  assert.strictEqual((await call('POST', '/api/requisitions/1/approve', purchaser)).status, 403);
});

test('only the foreman can file, revise or cancel a requisition', async () => {
  const owner = await loginAs('owner1');
  assert.strictEqual((await call('POST', '/api/requisitions', owner, {})).status, 403);
  assert.strictEqual((await call('PUT', '/api/requisitions/1', owner, {})).status, 403);
  assert.strictEqual((await call('POST', '/api/requisitions/1/cancel', owner, {})).status, 403);
});

test('purchaser cannot read requisitions yet', async () => {
  const purchaser = await loginAs('purchaser1');
  assert.strictEqual((await call('GET', '/api/requisitions', purchaser)).status, 403);
});

test('only owner and custodian can add or edit items', async () => {
  const foreman = await loginAs('foreman1');
  assert.strictEqual((await call('POST', '/api/items', foreman, {})).status, 403);
  assert.strictEqual((await call('PUT', '/api/items/1', foreman, {})).status, 403);
  const custodian = await loginAs('custodian1');
  const res = await call('POST', '/api/items', custodian, {});
  assert.strictEqual(res.status, 400); // allowed in, then refused for the empty form
  assert.match((await res.json()).error, /Item code/);
});

test('a foreman filing an empty requisition gets a plain 400 message', async () => {
  const foreman = await loginAs('foreman1');
  const res = await call('POST', '/api/requisitions', foreman, {});
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /project/i);
});

test('a bad id is a 400, not a crash', async () => {
  const owner = await loginAs('owner1');
  assert.strictEqual((await call('GET', '/api/requisitions/abc', owner)).status, 400);
});

test('broken JSON is a 400', async () => {
  const foreman = await loginAs('foreman1');
  const res = await fetch(base + '/api/requisitions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: foreman }, body: '{oops',
  });
  assert.strictEqual(res.status, 400);
});
