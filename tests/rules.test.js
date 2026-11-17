const test = require('node:test');
const assert = require('node:assert');
const { validateRfInput, canRevise, todayString } = require('../server/services/rfRules');
const { validateItemInput } = require('../server/services/itemRules');

const TODAY = '2026-11-17';
const good = () => ({
  projectId: 1, dateNeeded: '2026-11-20', urgency: 'normal', purpose: 'Replace drain pump',
  lines: [{ itemId: 7, quantity: 1 }],
});
const fails = (fn, text) => assert.throws(fn, (err) => err.status === 400 && err.message.includes(text));

test('a complete requisition passes', () => {
  const out = validateRfInput(good(), TODAY);
  assert.deepStrictEqual(out.lines, [{ itemId: 7, quantity: 1 }]);
  assert.strictEqual(out.purpose, 'Replace drain pump');
});

test('date needed may be today but not yesterday, and must be a real date', () => {
  assert.doesNotThrow(() => validateRfInput({ ...good(), dateNeeded: TODAY }, TODAY));
  fails(() => validateRfInput({ ...good(), dateNeeded: '2026-11-16' }, TODAY), 'date needed');
  fails(() => validateRfInput({ ...good(), dateNeeded: '2026-02-30' }, TODAY), 'date needed');
  fails(() => validateRfInput({ ...good(), dateNeeded: '' }, TODAY), 'date needed');
});

test('missing project, urgency, purpose or items are refused', () => {
  fails(() => validateRfInput({ ...good(), projectId: 0 }, TODAY), 'project');
  fails(() => validateRfInput({ ...good(), urgency: 'asap' }, TODAY), 'urgency');
  fails(() => validateRfInput({ ...good(), purpose: '   ' }, TODAY), 'purpose');
  fails(() => validateRfInput({ ...good(), lines: [] }, TODAY), 'at least one item');
});

test('quantities must be above zero with at most 2 decimals', () => {
  fails(() => validateRfInput({ ...good(), lines: [{ itemId: 7, quantity: 0 }] }, TODAY), 'quantity');
  fails(() => validateRfInput({ ...good(), lines: [{ itemId: 7, quantity: -1 }] }, TODAY), 'quantity');
  fails(() => validateRfInput({ ...good(), lines: [{ itemId: 7, quantity: 1.005 }] }, TODAY), 'quantity');
  assert.doesNotThrow(() => validateRfInput({ ...good(), lines: [{ itemId: 7, quantity: 2.5 }] }, TODAY));
});

test('an item listed twice, or a line without an item, is refused', () => {
  fails(() => validateRfInput({ ...good(), lines: [{ itemId: 7, quantity: 1 }, { itemId: 7, quantity: 2 }] }, TODAY), 'twice');
  fails(() => validateRfInput({ ...good(), lines: [{ itemId: 0, quantity: 1 }] }, TODAY), 'item');
});

test('a returned RF can be revised once, then only cancelled', () => {
  assert.strictEqual(canRevise({ Status: 'returned', RevisionCount: 0 }), true);
  assert.strictEqual(canRevise({ Status: 'returned', RevisionCount: 1 }), false);
  assert.strictEqual(canRevise({ Status: 'pending', RevisionCount: 0 }), false);
  assert.strictEqual(canRevise({ Status: 'cancelled', RevisionCount: 0 }), false);
});

test('todayString looks like 2026-11-17', () => {
  assert.match(todayString(new Date(2026, 10, 17)), /^2026-11-17$/);
});

test('item form: code is cleaned up, bad values are refused', () => {
  const item = validateItemInput({ code: ' hdpe-007 ', description: 'Tee', unit: 'pc', reorderPoint: '2', leadTimeDays: '30' }, { creating: true });
  assert.strictEqual(item.code, 'HDPE-007');
  assert.strictEqual(item.reorderPoint, 2);
  assert.strictEqual(item.isActive, true);
  assert.throws(() => validateItemInput({ code: 'a b', description: 'x', unit: 'pc' }, { creating: true }), (e) => e.status === 400);
  assert.throws(() => validateItemInput({ description: '', unit: 'pc' }, { creating: false }), (e) => e.status === 400);
  assert.throws(() => validateItemInput({ description: 'x', unit: 'pc', leadTimeDays: 1.5 }, { creating: false }), (e) => e.status === 400);
  assert.throws(() => validateItemInput({ description: 'x', unit: 'pc', reorderPoint: -1 }, { creating: false }), (e) => e.status === 400);
});

test('item edit never changes the code and can deactivate', () => {
  const item = validateItemInput({ code: 'IGNORED', description: 'Tee', unit: 'pc', isActive: false }, { creating: false });
  assert.strictEqual(item.code, undefined);
  assert.strictEqual(item.isActive, false);
});
