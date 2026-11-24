// Projects: the owner adds them, sets the material budget and closes them. Real database, real server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { db, start, stop, loginAs, call, rfBody, user, itemId } = require('./helpers');
const rules = require('../server/services/projectRules');

test.before(start);
test.after(stop);

const json = async (res, status) => { assert.strictEqual(res.status, status, await res.clone().text()); return res.json(); };
const projectCount = () => db.get('SELECT COUNT(*) AS n FROM Project').n;
const rowOf = (code) => db.get('SELECT * FROM Project WHERE Code = @code', { code });
const listed = async (owner, code) => (await json(await call('GET', '/api/projects/all', owner), 200)).find((p) => p.Code === code);
// A PO with no PR still counts against the budget, in whole centavos.
let poNumbers = 0;
const addPo = (projectId, totalCentavos) => db.run(
  `INSERT INTO PurchaseOrder (PoNumber, SupplierId, ProjectId, SubtotalCentavos, TotalCentavos, CreatedBy)
   VALUES (@poNumber, (SELECT MIN(SupplierId) FROM Supplier), @projectId, @total, @total, @userId)`,
  { poNumber: `PO-PRJ-${++poNumbers}`, projectId, total: totalCentavos, userId: user('purchaser1').id });

test('project form: the code is cleaned up, the name is required, the budget is whole centavos, the status is checked', () => {
  const fine = rules.validateProjectInput({ code: '  adc-reception ', name: ' ADC Reception ', materialBudgetCentavos: 450000 }, { creating: true });
  assert.deepStrictEqual(fine, { code: 'ADC-RECEPTION', name: 'ADC Reception', materialBudgetCentavos: 450000, status: 'active' });
  // No budget given: 0 means none is set.
  assert.strictEqual(rules.validateProjectInput({ code: 'NEW-1', name: 'New' }, { creating: true }).materialBudgetCentavos, 0);
  // Editing: no code in the result, the status must be chosen.
  assert.deepStrictEqual(rules.validateProjectInput({ code: 'IGNORED', name: 'Renamed', materialBudgetCentavos: 0, status: 'closed' }, { creating: false }),
    { name: 'Renamed', materialBudgetCentavos: 0, status: 'closed' });

  for (const code of ['', 'A', 'bad code', '-AB', 'AB_CD', 'X'.repeat(31), null, undefined]) {
    assert.throws(() => rules.validateProjectInput({ code, name: 'Name' }, { creating: true }), /Project code/, String(code));
  }
  for (const name of ['', '   ', 'N'.repeat(201), null, undefined]) {
    assert.throws(() => rules.validateProjectInput({ code: 'OK-1', name }, { creating: true }), /project name/, String(name));
  }
  for (const budget of [-1, 1.5, '4500', null, NaN, Infinity, rules.MAX_BUDGET_CENTAVOS + 1, true]) {
    assert.throws(() => rules.validateProjectInput({ code: 'OK-1', name: 'Name', materialBudgetCentavos: budget }, { creating: true }), /material budget/, String(budget));
  }
  assert.strictEqual(rules.validateProjectInput({ code: 'OK-1', name: 'Name', materialBudgetCentavos: rules.MAX_BUDGET_CENTAVOS }, { creating: true }).materialBudgetCentavos, rules.MAX_BUDGET_CENTAVOS);
  // Editing needs the budget (a missing one must not wipe it) and a real status.
  assert.throws(() => rules.validateProjectInput({ name: 'Name', status: 'active' }, { creating: false }), /material budget/);
  for (const status of [undefined, '', 'Active', 'archived', null]) {
    assert.throws(() => rules.validateProjectInput({ name: 'Name', materialBudgetCentavos: 0, status }, { creating: false }), /Active or Closed/, String(status));
  }
});

test('the budget box on the page: every centavo amount reads back exactly, and wrong text is refused', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'purchasing-ui.js'), 'utf8');
  const ui = new Function('h', `${source}\nreturn { toBudgetCentavos, pesosPlain };`)(() => null);
  for (let centavos = 0; centavos <= 1000000; centavos += 1) {
    if (ui.toBudgetCentavos(ui.pesosPlain(centavos)) !== centavos) assert.fail(`${centavos} did not read back`);
  }
  assert.deepStrictEqual(['', '  ', '0', '0.00', '4,500', ' 12.5 ', '1,234.56', '100000000'].map(ui.toBudgetCentavos), [0, 0, 0, 0, 450000, 1250, 123456, 10000000000]);
  for (const bad of ['-1', '1.234', 'abc', '1e5', '4.', '.5', '₱4500', '4 500']) assert.strictEqual(ui.toBudgetCentavos(bad), null, bad);
});

test('only the owner manages projects; everyone logged in still gets the plain active list, with no money', async () => {
  assert.strictEqual((await call('GET', '/api/projects/all')).status, 401);
  assert.strictEqual((await call('POST', '/api/projects', undefined, { code: 'NOPE-1', name: 'No' })).status, 401);
  const before = projectCount();
  for (const who of ['foreman1', 'custodian1', 'purchaser1', 'verifier1']) {
    const cookie = await loginAs(who);
    assert.strictEqual((await call('GET', '/api/projects/all', cookie)).status, 403, `${who} list`);
    assert.strictEqual((await call('POST', '/api/projects', cookie, { code: 'NOPE-1', name: 'No' })).status, 403, `${who} add`);
    assert.strictEqual((await call('PUT', '/api/projects/1', cookie, { name: 'Hacked', materialBudgetCentavos: 1, status: 'active' })).status, 403, `${who} edit`);
    const plain = await json(await call('GET', '/api/projects', cookie), 200);
    assert.ok(plain.length >= 1);
    for (const p of plain) assert.deepStrictEqual(Object.keys(p), ['ProjectId', 'Code', 'Name'], `${who} sees no money`);
  }
  assert.strictEqual(projectCount(), before);
  assert.notStrictEqual(db.get('SELECT Name FROM Project WHERE ProjectId = 1').Name, 'Hacked');
  const owner = await loginAs('owner1');
  assert.strictEqual((await call('GET', '/api/projects/all', owner)).status, 200);
});

test('adding a project: it is saved clean, listed with its budget, and a repeated code or a bad form changes nothing', async () => {
  const owner = await loginAs('owner1');
  const made = await json(await call('POST', '/api/projects', owner, { code: ' pipe-works ', name: '  Pipe works, Block 4 ', materialBudgetCentavos: 1250000 }), 201);
  assert.ok(made.id > 0);
  assert.deepStrictEqual({ ...rowOf('PIPE-WORKS') }, { ProjectId: made.id, Code: 'PIPE-WORKS', Name: 'Pipe works, Block 4', MaterialBudgetCentavos: 1250000, Status: 'active' });

  // No budget: saved as 0, and Left is null, not a number.
  await json(await call('POST', '/api/projects', owner, { code: 'NO-BUDGET', name: 'No budget yet' }), 201);
  assert.strictEqual(rowOf('NO-BUDGET').MaterialBudgetCentavos, 0);

  const before = projectCount();
  const again = await call('POST', '/api/projects', owner, { code: 'Pipe-Works', name: 'Another', materialBudgetCentavos: 1 });
  assert.strictEqual(again.status, 409);
  assert.match((await again.json()).error, /already used/);
  assert.strictEqual(rowOf('PIPE-WORKS').Name, 'Pipe works, Block 4', 'the first project is untouched');
  for (const bad of [{ name: 'No code' }, { code: 'X', name: 'Short code' }, { code: 'OK-2' }, { code: 'OK-2', name: 'Bad budget', materialBudgetCentavos: -5 }, { code: 'OK-2', name: 'Bad budget', materialBudgetCentavos: '100' }]) {
    assert.strictEqual((await call('POST', '/api/projects', owner, bad)).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await call('POST', '/api/projects', owner)).status, 400, 'no body at all');
  assert.strictEqual(projectCount(), before, 'every refusal wrote nothing');

  // The list: active projects first, then by code.
  const all = await json(await call('GET', '/api/projects/all', owner), 200);
  assert.deepStrictEqual(Object.keys(all[0]), ['ProjectId', 'Code', 'Name', 'Status', 'MaterialBudgetCentavos', 'PromisedCentavos', 'LeftCentavos']);
  const row = all.find((p) => p.Code === 'PIPE-WORKS');
  assert.deepStrictEqual([row.MaterialBudgetCentavos, row.PromisedCentavos, row.LeftCentavos], [1250000, 0, 1250000]);
  assert.deepStrictEqual([...all].map((p) => p.Code), [...all].map((p) => p.Code).sort(), 'all active, so sorted by code');
});

test('editing a project: name, budget and status change; the code never does; a missing project is a 404', async () => {
  const owner = await loginAs('owner1');
  const { id } = await json(await call('POST', '/api/projects', owner, { code: 'EDIT-ME', name: 'Before', materialBudgetCentavos: 100000 }), 201);
  await json(await call('PUT', `/api/projects/${id}`, owner, { code: 'CHANGED', name: ' After ', materialBudgetCentavos: 250050, status: 'active' }), 200);
  assert.deepStrictEqual({ ...rowOf('EDIT-ME') }, { ProjectId: id, Code: 'EDIT-ME', Name: 'After', MaterialBudgetCentavos: 250050, Status: 'active' });
  assert.strictEqual(rowOf('CHANGED'), undefined, 'the code was not changed');

  // Budget 0 takes the budget away again.
  await json(await call('PUT', `/api/projects/${id}`, owner, { name: 'After', materialBudgetCentavos: 0, status: 'active' }), 200);
  assert.strictEqual(rowOf('EDIT-ME').MaterialBudgetCentavos, 0);

  const snapshot = { ...rowOf('EDIT-ME') };
  for (const bad of [{ name: 'X', status: 'active' }, { name: 'X', materialBudgetCentavos: 5 }, { name: '', materialBudgetCentavos: 5, status: 'active' }, { name: 'X', materialBudgetCentavos: 5, status: 'archived' }, { name: 'X', materialBudgetCentavos: 1.5, status: 'active' }]) {
    assert.strictEqual((await call('PUT', `/api/projects/${id}`, owner, bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepStrictEqual({ ...rowOf('EDIT-ME') }, snapshot, 'every refused edit changed nothing');
  assert.strictEqual((await call('PUT', '/api/projects/999999', owner, { name: 'Ghost', materialBudgetCentavos: 0, status: 'active' })).status, 404);
  assert.strictEqual((await call('PUT', '/api/projects/abc', owner, { name: 'Ghost', materialBudgetCentavos: 0, status: 'active' })).status, 400);
});

test('a closed project drops out of the pick list and cannot take a new requisition; reopening brings it back', async () => {
  const owner = await loginAs('owner1');
  const foreman = await loginAs('foreman1');
  const { id } = await json(await call('POST', '/api/projects', owner, { code: 'CLOSE-ME', name: 'To be closed', materialBudgetCentavos: 0 }), 201);
  const pickCodes = async () => (await json(await call('GET', '/api/projects', foreman), 200)).map((p) => p.Code);
  const fileRf = () => call('POST', '/api/requisitions', foreman, { ...rfBody([['HDPE-001', 1]]), projectId: id });
  const edit = (status) => call('PUT', `/api/projects/${id}`, owner, { name: 'To be closed', materialBudgetCentavos: 0, status });

  assert.ok((await pickCodes()).includes('CLOSE-ME'));
  const rf = await json(await fileRf(), 201); // filed while active
  await json(await edit('closed'), 200);
  assert.ok(!(await pickCodes()).includes('CLOSE-ME'), 'closed: not in the pick list');
  const refused = await fileRf();
  assert.strictEqual(refused.status, 400);
  assert.match((await refused.json()).error, /not available/);
  assert.strictEqual((await json(await call('GET', `/api/requisitions/${rf.id}`, foreman), 200)).ProjectCode, 'CLOSE-ME', 'the RF filed before stays as it was');

  // The owner still sees it, last, marked closed.
  const all = await json(await call('GET', '/api/projects/all', owner), 200);
  assert.strictEqual(all.at(-1).Code, 'CLOSE-ME');
  assert.strictEqual(all.at(-1).Status, 'closed');
  assert.ok(all.slice(0, -1).every((p) => p.Status === 'active'), 'active ones come first');

  await json(await edit('active'), 200);
  assert.ok((await pickCodes()).includes('CLOSE-ME'));
  await json(await fileRf(), 201);
});

test('already promised and left follow the purchase orders; no budget means nothing is left to count', async () => {
  const owner = await loginAs('owner1');
  const { id } = await json(await call('POST', '/api/projects', owner, { code: 'MONEY-1', name: 'Money check', materialBudgetCentavos: 100000 }), 201);
  const none = await json(await call('POST', '/api/projects', owner, { code: 'MONEY-2', name: 'Money check, no budget', materialBudgetCentavos: 0 }), 201);
  const read = async (code) => { const p = await listed(owner, code); return [p.MaterialBudgetCentavos, p.PromisedCentavos, p.LeftCentavos]; };

  assert.deepStrictEqual(await read('MONEY-1'), [100000, 0, 100000]);
  addPo(id, 30000);
  assert.deepStrictEqual(await read('MONEY-1'), [100000, 30000, 70000]);
  addPo(id, 80000);
  assert.deepStrictEqual(await read('MONEY-1'), [100000, 110000, -10000], 'over the budget shows as a negative amount');
  addPo(none.id, 5000);
  assert.deepStrictEqual(await read('MONEY-2'), [0, 5000, null], 'promised is still counted, left is null');
  // Another project's orders never leak in.
  assert.deepStrictEqual(await read('MONEY-1'), [100000, 110000, -10000]);
  // A bigger budget moves Left at once.
  await json(await call('PUT', `/api/projects/${id}`, owner, { name: 'Money check', materialBudgetCentavos: 200000, status: 'active' }), 200);
  assert.deepStrictEqual(await read('MONEY-1'), [200000, 110000, 90000]);
});

test('deleting a project: an unused one is removed for good; one that any document uses is refused and stays', async () => {
  const owner = await loginAs('owner1');
  const foreman = await loginAs('foreman1');
  const add = async (code) => (await json(await call('POST', '/api/projects', owner, { code, name: `Project ${code}`, materialBudgetCentavos: 100000 }), 201)).id;
  const remove = (id, cookie = owner) => call('DELETE', `/api/projects/${id}`, cookie);
  const refused = async (id, code) => {
    const res = await remove(id);
    assert.strictEqual(res.status, 409, `${code} should be refused`);
    const { error } = await res.json();
    assert.match(error, new RegExp(`^${code} is already used`));
    assert.match(error, /Set it to Closed instead\./);
    assert.ok(rowOf(code), `${code} is still there`);
  };

  // Unused: gone from the table, pick list and database; the code can be reused.
  const unused = await add('DEL-UNUSED');
  assert.deepStrictEqual(await json(await remove(unused), 200), { id: unused });
  assert.strictEqual(rowOf('DEL-UNUSED'), undefined);
  assert.ok(!(await json(await call('GET', '/api/projects/all', owner), 200)).some((p) => p.Code === 'DEL-UNUSED'));
  assert.ok(!(await json(await call('GET', '/api/projects', foreman), 200)).some((p) => p.Code === 'DEL-UNUSED'));
  await add('DEL-UNUSED');

  // Closed and never used can be deleted too.
  const closed = await add('DEL-CLOSED');
  await json(await call('PUT', `/api/projects/${closed}`, owner, { name: 'x', materialBudgetCentavos: 0, status: 'closed' }), 200);
  await json(await remove(closed), 200);
  assert.strictEqual(rowOf('DEL-CLOSED'), undefined);

  // A requisition uses it.
  const withRf = await add('DEL-RF');
  const rf = await json(await call('POST', '/api/requisitions', foreman, { ...rfBody([['HDPE-001', 1]]), projectId: withRf }), 201);
  await refused(withRf, 'DEL-RF');
  assert.strictEqual((await json(await call('GET', `/api/requisitions/${rf.id}`, foreman), 200)).ProjectCode, 'DEL-RF');

  // A purchase requisition uses it.
  const withPr = await add('DEL-PR');
  const prId = db.run(`INSERT INTO PurchaseRequisition (PrNumber, ProjectId) VALUES ('PR-DEL-1', @id)`, { id: withPr }).lastId;
  await refused(withPr, 'DEL-PR');

  // A purchase order uses it.
  const withPo = await add('DEL-PO');
  addPo(withPo, 5000);
  await refused(withPo, 'DEL-PO');

  // A stock record uses it.
  const withStock = await add('DEL-STOCK');
  db.run(`INSERT INTO StockTransaction (ItemId, TxType, Quantity, ProjectId, CreatedBy) VALUES (@item, 'receipt', 1, @id, @user)`,
    { item: itemId('HDPE-001'), id: withStock, user: user('owner1').id });
  await refused(withStock, 'DEL-STOCK');

  // The refusal follows the data: once the only document is gone, the project can go.
  db.run('DELETE FROM PurchaseRequisition WHERE PurchaseRequisitionId = @id', { id: prId });
  await json(await remove(withPr), 200);
  assert.strictEqual(rowOf('DEL-PR'), undefined);

  // A project that does not exist, and a bad id.
  assert.strictEqual((await remove(999999)).status, 404);
  assert.strictEqual((await remove('abc')).status, 400);

  // Only the owner. The unused project survives every try.
  const keep = await add('DEL-KEEP');
  assert.strictEqual((await call('DELETE', `/api/projects/${keep}`)).status, 401);
  for (const who of ['foreman1', 'custodian1', 'purchaser1', 'verifier1']) {
    assert.strictEqual((await remove(keep, await loginAs(who))).status, 403, who);
  }
  assert.ok(rowOf('DEL-KEEP'));
});
