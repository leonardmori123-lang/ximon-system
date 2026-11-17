const test = require('node:test');
const assert = require('node:assert');
const { db } = require('./helpers');
const { setup } = require('../scripts/setup-db');

const count = (table) => db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;

test('setup creates users, settings, project, items and one opening stock row', () => {
  assert.strictEqual(count('AppUser'), 5);
  assert.strictEqual(count('Setting'), 4);
  assert.strictEqual(count('Project'), 1);
  assert.strictEqual(count('Item'), 7);
  assert.strictEqual(count('StockTransaction'), 1); // HDPE-001 starts with 10
});

test('running setup again changes nothing', () => {
  setup({ quiet: true });
  setup({ quiet: true });
  assert.deepStrictEqual([count('AppUser'), count('Setting'), count('Project'), count('Item'), count('StockTransaction')], [5, 4, 1, 7, 1]);
});

test('the database refuses impossible stock: reserved above on hand, or negative', () => {
  assert.throws(() => db.run(`UPDATE Item SET Reserved = 99 WHERE Code = 'HDPE-001'`), /CHECK constraint/);
  assert.throws(() => db.run(`UPDATE Item SET OnHand = -1 WHERE Code = 'ACU-001'`), /CHECK constraint/);
});

test('foreign keys are on: a requisition for a missing project is refused', () => {
  assert.throws(() => db.run(
    `INSERT INTO Requisition (RfNumber, ProjectId, RequestedBy, DateNeeded, Urgency, Purpose)
     VALUES ('X', 999, 1, '2030-01-01', 'normal', 'x')`), /FOREIGN KEY/);
});
