const test = require('node:test');
const assert = require('node:assert');
const { requireRole, ROLES } = require('../server/auth');

function run(middleware, user) {
  const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
  let passed = false;
  middleware({ session: { user } }, res, () => { passed = true; });
  return { passed, res };
}

test('requireRole lets the right role through', () => {
  assert.strictEqual(run(requireRole(ROLES.OWNER), { role: 'owner' }).passed, true);
});

test('requireRole blocks another role with 403', () => {
  const { passed, res } = run(requireRole(ROLES.OWNER), { role: 'foreman' });
  assert.strictEqual(passed, false);
  assert.strictEqual(res.code, 403);
});

test('requireRole blocks nobody-logged-in with 401', () => {
  const { passed, res } = run(requireRole(ROLES.OWNER), undefined);
  assert.strictEqual(passed, false);
  assert.strictEqual(res.code, 401);
});
