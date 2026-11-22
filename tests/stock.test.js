const test = require('node:test');
const assert = require('node:assert');
const { planReservation, isLowStock } = require('../server/services/stockRules');

test('enough stock: reserve everything, no shortage', () => {
  assert.deepStrictEqual(planReservation(3, 10), { reserve: 3, short: 0 });
});

test('not enough stock: reserve what is there, the rest is the shortage', () => {
  assert.deepStrictEqual(planReservation(9, 7), { reserve: 7, short: 2 });
});

test('no stock at all: reserve nothing, everything is short', () => {
  assert.deepStrictEqual(planReservation(1, 0), { reserve: 0, short: 1 });
});

test('never reserves a negative amount, even if available looks negative', () => {
  assert.deepStrictEqual(planReservation(2, -1), { reserve: 0, short: 2 });
});

test('decimals do not drift', () => {
  assert.deepStrictEqual(planReservation(2.75, 1.1), { reserve: 1.1, short: 1.65 });
});

// isLowStock takes a row of the Item list.
const row = (extra) => ({ IsActive: 1, OnHand: 10, Reserved: 0, ReorderPoint: 2, ...extra });

test('low stock: Available equal to the reorder point is Low', () => {
  assert.strictEqual(isLowStock(row({ OnHand: 2 })), true);
  assert.strictEqual(isLowStock(row({ OnHand: 1 })), true);
  assert.strictEqual(isLowStock(row({ OnHand: 0 })), true);
});

test('low stock: above the reorder point is not Low', () => {
  assert.strictEqual(isLowStock(row({ OnHand: 3 })), false);
  assert.strictEqual(isLowStock(row({ OnHand: 10 })), false);
});

test('low stock: a reorder point of 0 means none is set, so it is never Low', () => {
  assert.strictEqual(isLowStock(row({ ReorderPoint: 0, OnHand: 0 })), false);
});

test('low stock: an inactive item is never Low', () => {
  assert.strictEqual(isLowStock(row({ IsActive: 0, OnHand: 0 })), false);
});

test('low stock: reserved units count (10 on hand, 9 reserved, reorder point 2 is Low)', () => {
  assert.strictEqual(isLowStock(row({ OnHand: 10, Reserved: 9, ReorderPoint: 2 })), true);
  assert.strictEqual(isLowStock(row({ OnHand: 10, Reserved: 7, ReorderPoint: 2 })), false);
});

test('low stock: decimals do not drift (1.1 - 0.9 is 0.20000000000000007 before rounding)', () => {
  assert.strictEqual(isLowStock(row({ OnHand: 1.1, Reserved: 0.9, ReorderPoint: 0.2 })), true);
  assert.strictEqual(isLowStock(row({ OnHand: 0.3, Reserved: 0.1, ReorderPoint: 0.2 })), true);
  assert.strictEqual(isLowStock(row({ OnHand: 0.3, Reserved: 0.1, ReorderPoint: 0.19 })), false);
});
