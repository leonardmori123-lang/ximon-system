// Stock adjustment: the custodian fixes a wrong count. Real database, real SQL.
// Tests in one file share a database, so each test reads the current On hand instead of assuming 10.
const test = require('node:test');
const assert = require('node:assert');
const { db, start, stop, loginAs, call, user, item, itemId, rfBody } = require('./helpers');
const rf = require('../server/services/requisitions');
const { adjustStock } = require('../server/services/adjustments');
const notes = require('../server/services/notifications');

test.before(async () => {
  // a second active owner, and one who is switched off, to check who is told
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role) VALUES ('Second Owner', 'owner2', 'x', 'owner')`);
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role, IsActive) VALUES ('Gone Owner', 'owner3', 'x', 'owner', 0)`);
  await start();
});
test.after(stop);

const inbox = (username) => notes.listFor(user(username).id).map((n) => ({ ...n }));

const foreman = user('foreman1');
const owner = user('owner1');
const custodian = user('custodian1');
const rejects = (fn, status, text) => assert.throws(fn, (e) => e.status === status && (!text || e.message.includes(text)));
const adjust = (code, counted, reason = 'Recount') => adjustStock({ itemId: itemId(code), counted, reason, userId: custodian.id });
const approved = (lines) => { const { id } = rf.createRequisition(foreman, rfBody(lines)); rf.approveRequisition(owner, id); return id; };
const logRows = () => db.get('SELECT COUNT(*) AS n FROM StockTransaction').n;
const lastTx = () => ({ ...db.get('SELECT ItemId, TxType, Quantity, RefDocType, RefDocId, ProjectId, CreatedBy, Note FROM StockTransaction ORDER BY TransactionId DESC LIMIT 1') });

function assertLogMatchesStock() {
  const rows = db.all(`SELECT i.Code, i.OnHand, ROUND(COALESCE(SUM(t.Quantity), 0), 2) AS Logged
                       FROM Item i LEFT JOIN StockTransaction t ON t.ItemId = i.ItemId GROUP BY i.ItemId`);
  for (const r of rows) assert.strictEqual(r.Logged + 0, r.OnHand, `${r.Code}: log ${r.Logged} vs on hand ${r.OnHand}`);
}

test('counting less, then more: the log gets a negative, then a positive adjustment', () => {
  const start = item('HDPE-001').OnHand; // 10 in a fresh database
  const down = adjust('HDPE-001', start - 2, 'Recount: two were damaged');
  assert.deepStrictEqual({ onHand: down.onHand, change: down.change }, { onHand: start - 2, change: -2 });
  assert.strictEqual(item('HDPE-001').OnHand, start - 2);
  assert.deepStrictEqual(lastTx(), { ItemId: itemId('HDPE-001'), TxType: 'adjustment', Quantity: -2, RefDocType: null, RefDocId: null, ProjectId: null, CreatedBy: custodian.id, Note: 'Recount: two were damaged' });
  assertLogMatchesStock();

  const up = adjust('HDPE-001', start + 2, 'Found a box in another bin');
  assert.deepStrictEqual({ onHand: up.onHand, change: up.change }, { onHand: start + 2, change: 4 });
  assert.strictEqual(lastTx().Quantity, 4);
  assert.strictEqual(lastTx().Note, 'Found a box in another bin');
  assert.strictEqual(up.transactionId, db.get('SELECT MAX(TransactionId) AS id FROM StockTransaction').id);
  assertLogMatchesStock();
});

test('the reason is trimmed, and decimals do not drift (10 to 10.3 logs 0.3)', () => {
  const now = item('HDPE-001').OnHand;
  const out = adjust('HDPE-001', Math.round((now + 0.3) * 100) / 100, '  Half a bag extra  ');
  assert.strictEqual(out.change, 0.3);
  assert.strictEqual(lastTx().Note, 'Half a bag extra');
  assert.strictEqual(lastTx().Quantity, 0.3);
  adjust('HDPE-001', now, 'Back to the old count');
  assertLogMatchesStock();
});

test('a count of zero is a real count, and the count can be given as text from a form', () => {
  const now = item('HDPE-004').OnHand; // 0 in the sample data
  assert.strictEqual(adjust('HDPE-004', '5', 'Opening count').onHand, 5);
  assert.strictEqual(adjust('HDPE-004', 0, 'All used up, nothing left').onHand, 0);
  assert.strictEqual(item('HDPE-004').OnHand, now);
  assertLogMatchesStock();
});

test('refused with nothing changed: empty reason, long reason, negative, 3 decimals, same count, unknown item, bad count', () => {
  const before = logRows();
  const stock = item('HDPE-001');
  const bad = (counted, reason) => adjustStock({ itemId: itemId('HDPE-001'), counted, reason, userId: custodian.id });
  rejects(() => bad(stock.OnHand + 1, ''), 400, 'reason');
  rejects(() => bad(stock.OnHand + 1, '   '), 400, 'reason');
  rejects(() => bad(stock.OnHand + 1, undefined), 400, 'reason');
  rejects(() => bad(stock.OnHand + 1, 'x'.repeat(201)), 400, '200 characters');
  rejects(() => bad(-1, 'Recount'), 400, 'zero or more');
  rejects(() => bad(stock.OnHand + 0.123, 'Recount'), 400, '2 decimals');
  rejects(() => bad(stock.OnHand, 'Recount'), 400, 'same as On hand');
  rejects(() => bad('', 'Recount'), 400, 'counted quantity');
  rejects(() => bad(undefined, 'Recount'), 400, 'counted quantity');
  rejects(() => bad(null, 'Recount'), 400, 'counted quantity');
  rejects(() => bad('abc', 'Recount'), 400, 'counted quantity');
  rejects(() => bad(true, 'Recount'), 400, 'counted quantity');
  rejects(() => adjustStock({ itemId: 999999, counted: 5, reason: 'Recount', userId: custodian.id }), 404, 'Item not found');
  rejects(() => adjustStock({ itemId: itemId('HDPE-001'), counted: 5, reason: 'Recount' }), 400, 'userId');
  rejects(() => adjustStock(undefined), 400);
  assert.strictEqual(logRows(), before);
  assert.deepStrictEqual(item('HDPE-001'), stock);
});

test('never below Reserved: with 3 reserved, a count of 2 is refused and a count of 3 works', () => {
  const reservedBefore = item('HDPE-001').Reserved;
  approved([['HDPE-001', 3]]);
  const { OnHand, Reserved } = item('HDPE-001');
  assert.strictEqual(Reserved, reservedBefore + 3);

  const before = logRows();
  rejects(() => adjust('HDPE-001', Reserved - 1), 400, `${Reserved} units are reserved for requisitions, so the count cannot be below ${Reserved}`);
  assert.strictEqual(logRows(), before);
  assert.strictEqual(item('HDPE-001').OnHand, OnHand);

  assert.strictEqual(adjust('HDPE-001', Reserved, 'Everything else was counted out').onHand, Reserved);
  assert.deepStrictEqual(item('HDPE-001'), { OnHand: Reserved, Reserved });
  assertLogMatchesStock();
});

test('the message uses the singular for one reserved unit', () => {
  adjust('HDPE-003', 4, 'Opening count'); // the sample data has none
  approved([['HDPE-003', 1]]);
  rejects(() => adjust('HDPE-003', 0), 400, '1 unit is reserved for requisitions, so the count cannot be below 1');
});

test('route: only the custodian may adjust; the list shows the new On hand', async () => {
  const id = itemId('HDPE-005');
  const body = { counted: 7, reason: 'Recount' };
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, undefined, body)).status, 401);
  for (const who of ['foreman1', 'owner1', 'purchaser1', 'verifier1']) {
    assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, await loginAs(who), body)).status, 403, who);
  }
  assert.strictEqual(item('HDPE-005').OnHand, 0); // nothing changed by the refused calls

  const c = await loginAs('custodian1');
  const res = await call('POST', `/api/items/${id}/adjust`, c, body);
  assert.strictEqual(res.status, 200);
  const out = await res.json();
  assert.deepStrictEqual({ onHand: out.onHand, change: out.change }, { onHand: 7, change: 7 });
  const list = await (await call('GET', '/api/items', c)).json();
  assert.strictEqual(list.find((i) => i.Code === 'HDPE-005').OnHand, 7);
  assert.strictEqual(list.find((i) => i.Code === 'HDPE-005').IsLow, false); // 7 is above its reorder point of 2
});

test('route: bad input gets a plain 400 or 404', async () => {
  const c = await loginAs('custodian1');
  const id = itemId('HDPE-005');
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, c, {})).status, 400);
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, c, { counted: '', reason: 'Recount' })).status, 400);
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, c, { counted: 9, reason: '' })).status, 400);
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, c, { counted: 7, reason: 'Recount' })).status, 400); // same as On hand
  assert.strictEqual((await call('POST', '/api/items/abc/adjust', c, { counted: 9, reason: 'Recount' })).status, 400);
  assert.strictEqual((await call('POST', '/api/items/999999/adjust', c, { counted: 9, reason: 'Recount' })).status, 404);
  const msg = await (await call('POST', `/api/items/${id}/adjust`, c, { counted: 9, reason: '' })).json();
  assert.match(msg.error, /reason/);
});

test('a low item can be fixed with an adjustment: the Low flag follows the new count', async () => {
  const c = await loginAs('custodian1');
  const before = (await (await call('GET', '/api/items', c)).json()).find((i) => i.Code === 'ACU-001');
  assert.strictEqual(before.IsLow, true); // 0 on hand, reorder point 1
  adjust('ACU-001', 3, 'Opening count');
  const after = (await (await call('GET', '/api/items', c)).json()).find((i) => i.Code === 'ACU-001');
  assert.strictEqual(after.IsLow, false);
  assertLogMatchesStock();
});

test('the owners are told about every adjustment: item code, old and new On hand, who counted, the reason', () => {
  const ownersBefore = { owner1: inbox('owner1').length, owner2: inbox('owner2').length };
  const others = { custodian1: inbox('custodian1').length, foreman1: inbox('foreman1').length, owner3: inbox('owner3').length };
  const old = item('HDPE-006').OnHand;
  adjust('HDPE-006', old + 4, 'Recount: found two boxes');
  for (const who of ['owner1', 'owner2']) {
    assert.strictEqual(inbox(who).length, ownersBefore[who] + 1, `${who} gets exactly one new notification`);
    const note = inbox(who)[0];
    assert.strictEqual(note.Message, `HDPE-006 was adjusted by Test Warehouse Custodian: On hand went from ${old} to ${old + 4}. Reason: Recount: found two boxes`);
    assert.strictEqual(note.LinkUrl, '/items.html');
    assert.strictEqual(note.IsRead, 0);
  }
  assert.strictEqual(inbox('custodian1').length, others.custodian1, 'the custodian is not told about his own count');
  assert.strictEqual(inbox('foreman1').length, others.foreman1);
  assert.strictEqual(inbox('owner3').length, others.owner3, 'an owner who is switched off is not told');
});

test('the message shows decimals and the trimmed reason', () => {
  const old = item('HDPE-006').OnHand;
  adjust('HDPE-006', Math.round((old - 0.3) * 100) / 100, '  Half a bag spilled  ');
  assert.strictEqual(inbox('owner1')[0].Message, `HDPE-006 was adjusted by Test Warehouse Custodian: On hand went from ${old} to ${Math.round((old - 0.3) * 100) / 100}. Reason: Half a bag spilled`);
});

test('a refused adjustment sends no notification at all', () => {
  const before = { owner1: inbox('owner1').length, owner2: inbox('owner2').length };
  const stock = item('HDPE-006');
  const bad = (counted, reason, extra = {}) => adjustStock({ itemId: itemId('HDPE-006'), counted, reason, userId: custodian.id, ...extra });
  rejects(() => bad(stock.OnHand + 1, ''), 400);
  rejects(() => bad(stock.OnHand + 1, 'x'.repeat(201)), 400);
  rejects(() => bad(-1, 'Recount'), 400);
  rejects(() => bad(stock.OnHand + 0.123, 'Recount'), 400);
  rejects(() => bad(stock.OnHand, 'Recount'), 400, 'same as On hand');
  rejects(() => bad('', 'Recount'), 400);
  rejects(() => bad(5, 'Recount', { itemId: 999999 }), 404);
  rejects(() => bad(5, 'Recount', { userId: 999999 }), 400, 'existing user');
  assert.deepStrictEqual({ owner1: inbox('owner1').length, owner2: inbox('owner2').length }, before);
  assert.deepStrictEqual(item('HDPE-006'), stock);
});

test('a count below Reserved is refused and sends nothing', () => {
  adjust('HDPE-002', 4, 'Opening count');
  approved([['HDPE-002', 3]]);
  const before = inbox('owner1').length;
  rejects(() => adjust('HDPE-002', 2), 400, '3 units are reserved');
  assert.strictEqual(inbox('owner1').length, before);
});

test('if the notification cannot be saved, the whole adjustment is undone (same transaction)', () => {
  // a trigger that makes the notification insert fail, only for a reason that contains FAIL-NOTICE
  db.exec(`CREATE TRIGGER fail_adjust_notice BEFORE INSERT ON Notification WHEN NEW.Message LIKE '%FAIL-NOTICE%'
           BEGIN SELECT RAISE(ABORT, 'notice failed'); END`);
  try {
    const stock = item('HDPE-006');
    const log = logRows();
    const owners = inbox('owner1').length;
    assert.throws(() => adjust('HDPE-006', stock.OnHand + 1, 'FAIL-NOTICE'), /notice failed/);
    assert.deepStrictEqual(item('HDPE-006'), stock, 'On hand is back to what it was');
    assert.strictEqual(logRows(), log, 'no log row is left behind');
    assert.strictEqual(inbox('owner1').length, owners);
  } finally {
    db.exec('DROP TRIGGER fail_adjust_notice');
  }
});

test('over the web: the owner sees the adjustment in Notifications, with both numbers and the reason', async () => {
  const c = await loginAs('custodian1');
  const id = itemId('HDPE-006');
  const old = item('HDPE-006').OnHand;
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, c, { counted: old + 1, reason: 'Recount at month end' })).status, 200);
  const owner1 = await loginAs('owner1');
  const data = await (await call('GET', '/api/notifications', owner1)).json();
  assert.ok(data.unread >= 1);
  assert.strictEqual(data.items[0].Message, `HDPE-006 was adjusted by Test Warehouse Custodian: On hand went from ${old} to ${old + 1}. Reason: Recount at month end`);
  assert.strictEqual(data.items[0].LinkUrl, '/items.html');

  // a refused call over the web sends nothing
  const count = data.items.length;
  assert.strictEqual((await call('POST', `/api/items/${id}/adjust`, c, { counted: old + 1, reason: 'Recount at month end' })).status, 400);
  const again = await (await call('GET', '/api/notifications', owner1)).json();
  assert.strictEqual(again.items.length, count);
});
