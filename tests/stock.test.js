const test = require('node:test');
const assert = require('node:assert');
const { planReservation } = require('../server/services/stockRules');

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
