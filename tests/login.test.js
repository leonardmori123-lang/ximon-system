const test = require('node:test');
const assert = require('node:assert');
const { start, stop, call, loginAs } = require('./helpers');

test.before(start);
test.after(stop);

test('wrong password and unknown user are refused', async () => {
  assert.strictEqual((await call('POST', '/api/login', null, { username: 'owner1', password: 'nope' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', null, { username: 'ghost', password: 'secret123' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', null, {})).status, 400);
});

test('right password logs in, /api/me shows the role, logout ends the session', async () => {
  const cookie = await loginAs('owner1');
  const me = await call('GET', '/api/me', cookie);
  assert.strictEqual(me.status, 200);
  assert.strictEqual((await me.json()).role, 'owner');
  await call('POST', '/api/logout', cookie, {});
  assert.strictEqual((await call('GET', '/api/me', cookie)).status, 401);
});

test('the username is not case sensitive', async () => {
  assert.ok(await loginAs('OWNER1'));
});

test('the health check reads the database', async () => {
  const res = await call('GET', '/api/health');
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.users, 5);
});
