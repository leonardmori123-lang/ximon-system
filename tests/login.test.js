// Tests the login and session flow without a database: server/db.js is replaced by a fake.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');

const dbPath = require.resolve('../server/db');
const hash = bcrypt.hashSync('secret123', 4);
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    sql: {},
    makeConfig: () => ({}),
    withTransaction: async () => {},
    query: async (text, params) =>
      params.username === 'owner1'
        ? [{ UserId: 1, FullName: 'Test Owner', PasswordHash: hash, Role: 'owner' }]
        : [],
  },
};
const app = require('../server/index');

let server, base;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const post = (url, body, cookie) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });

test('wrong password is refused', async () => {
  const res = await post('/api/login', { username: 'owner1', password: 'nope' });
  assert.strictEqual(res.status, 401);
});

test('unknown user is refused', async () => {
  const res = await post('/api/login', { username: 'ghost', password: 'secret123' });
  assert.strictEqual(res.status, 401);
});

test('right password logs in, /api/me shows the role, logout ends the session', async () => {
  const login = await post('/api/login', { username: 'owner1', password: 'secret123' });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const me = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
  assert.strictEqual(me.status, 200);
  assert.strictEqual((await me.json()).role, 'owner');

  await post('/api/logout', {}, cookie);
  const after = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
  assert.strictEqual(after.status, 401);
});
