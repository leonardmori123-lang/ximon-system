const test = require('node:test');
const assert = require('node:assert');
const { start, stop, call, loginAs } = require('./helpers');

test.before(start);
test.after(stop);

test('nobody logged in gets 401 on the slip routes', async () => {
  for (const [m, u] of [['GET', '/api/slips'], ['GET', '/api/slips/releasable'], ['POST', '/api/slips'],
    ['POST', '/api/slips/1/release'], ['POST', '/api/slips/1/acknowledge']]) {
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

test('bad requests are 400 or 404', async () => {
  const custodian = await loginAs('custodian1');
  assert.strictEqual((await call('POST', '/api/slips', custodian, {})).status, 400);
  assert.strictEqual((await call('GET', '/api/slips/abc', custodian)).status, 400);
  assert.strictEqual((await call('GET', '/api/slips/999', custodian)).status, 404);
  assert.strictEqual((await call('POST', '/api/slips', custodian, { requisitionId: 999 })).status, 404);
});
