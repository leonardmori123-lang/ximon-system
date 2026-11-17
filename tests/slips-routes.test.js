// Role protection on the slip routes, with the database replaced by a fake.
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
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
test.after(() => server.close());

async function loginAs(username) {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) });
  return res.headers.get('set-cookie').split(';')[0];
}
const call = (method, url, cookie, body) =>
  fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });

test('nobody logged in gets 401 on the slip routes', async () => {
  for (const [m, u] of [['GET', '/api/slips'], ['GET', '/api/slips/releasable'], ['POST', '/api/slips'], ['POST', '/api/slips/1/release'], ['POST', '/api/slips/1/acknowledge']]) {
    assert.strictEqual((await call(m, u)).status, 401, `${m} ${u}`);
  }
});

test('only the custodian prepares, releases or cancels slips', async () => {
  for (const who of ['foreman1', 'owner1', 'purchaser1']) {
    const c = await loginAs(who);
    assert.strictEqual((await call('POST', '/api/slips', c, { requisitionId: 1 })).status, 403, who);
    assert.strictEqual((await call('POST', '/api/slips/1/release', c)).status, 403, who);
    assert.strictEqual((await call('POST', '/api/slips/1/cancel', c)).status, 403, who);
  }
});

test('only the foreman can confirm receipt', async () => {
  for (const who of ['owner1', 'custodian1', 'purchaser1']) {
    assert.strictEqual((await call('POST', '/api/slips/1/acknowledge', await loginAs(who), {})).status, 403, who);
  }
});

test('the releasable list is for the custodian only; a purchaser cannot read slips', async () => {
  assert.strictEqual((await call('GET', '/api/slips/releasable', await loginAs('foreman1'))).status, 403);
  assert.strictEqual((await call('GET', '/api/slips', await loginAs('purchaser1'))).status, 403);
});

test('preparing a slip without a requisition, or with a bad id, is a 400', async () => {
  const custodian = await loginAs('custodian1');
  assert.strictEqual((await call('POST', '/api/slips', custodian, {})).status, 400);
  assert.strictEqual((await call('GET', '/api/slips/abc', custodian)).status, 400);
});
