// In-app notifications: who is told what, when. Real database; purchasing is replaced by a stub.
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');

const handoffPath = require.resolve('../server/services/handoff');
let handoffShouldFail = false;
require.cache[handoffPath] = {
  id: handoffPath, filename: handoffPath, loaded: true,
  exports: { createPurchaseRequisition: () => { if (handoffShouldFail) throw new Error('purchasing is broken'); return null; } },
};

const { db, start, stop, loginAs, call, user, rfBody } = require('./helpers');
const rf = require('../server/services/requisitions');
const slips = require('../server/services/issuance');
const notes = require('../server/services/notifications');

const foreman = user('foreman1');
const owner = user('owner1');
const custodian = user('custodian1');
const hash = bcrypt.hashSync('secret123', 4);

test.before(async () => {
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role) VALUES ('Second Owner', 'owner2', @hash, 'owner')`, { hash });
  db.run(`INSERT INTO AppUser (FullName, Username, PasswordHash, Role, IsActive) VALUES ('Gone Owner', 'owner3', @hash, 'owner', 0)`, { hash });
  await start();
});
test.after(stop);

const inbox = (username) => notes.listFor(user(username).id).map((n) => ({ ...n }));
const latest = (username) => inbox(username)[0];
const countFor = (username) => inbox(username).length;

test('filing an RF tells every active owner, and nobody else', () => {
  const { id, rfNumber } = rf.createRequisition(foreman, rfBody([['HDPE-001', 1]]));
  for (const who of ['owner1', 'owner2']) {
    assert.match(latest(who).Message, new RegExp(`${rfNumber} was filed by Test Foreman and needs your approval`));
    assert.strictEqual(latest(who).LinkUrl, `/requisition.html?id=${id}`);
    assert.strictEqual(latest(who).IsRead, 0);
  }
  assert.strictEqual(countFor('owner3'), 0, 'an inactive owner is not told');
  assert.strictEqual(countFor('foreman1'), 0);
  assert.strictEqual(countFor('custodian1'), 0);
});

test('approving tells the requestor and the warehouse when items are reserved', () => {
  const { id, rfNumber } = rf.createRequisition(foreman, rfBody([['HDPE-001', 2]]));
  const custodianBefore = countFor('custodian1');
  rf.approveRequisition(owner, id);
  assert.strictEqual(latest('foreman1').Message, `${rfNumber} was approved. All items are reserved.`);
  assert.strictEqual(countFor('custodian1'), custodianBefore + 1);
  assert.match(latest('custodian1').Message, new RegExp(`${rfNumber} is approved and has reserved items ready for a slip`));
  assert.strictEqual(latest('custodian1').LinkUrl, '/slips.html');
});

test('a shortage is mentioned, and the warehouse is not told when nothing was reserved', () => {
  const { id, rfNumber } = rf.createRequisition(foreman, rfBody([['ACU-001', 1]]));
  const custodianBefore = countFor('custodian1');
  rf.approveRequisition(owner, id);
  assert.strictEqual(latest('foreman1').Message, `${rfNumber} was approved. 1 item is short of stock.`);
  assert.strictEqual(countFor('custodian1'), custodianBefore);
});

test('returning tells the requestor why; revising tells the owners again', () => {
  const { id, rfNumber } = rf.createRequisition(foreman, rfBody([['HDPE-002', 1]]));
  rf.returnRequisition(owner, id, 'Wrong project');
  assert.strictEqual(latest('foreman1').Message, `${rfNumber} was returned: Wrong project`);
  assert.strictEqual(latest('foreman1').LinkUrl, `/requisition.html?id=${id}`);

  rf.reviseRequisition(foreman, id, rfBody([['HDPE-002', 2]]));
  for (const who of ['owner1', 'owner2']) {
    assert.match(latest(who).Message, new RegExp(`${rfNumber} was revised by Test Foreman and needs your approval again`));
  }
});

test('releasing a slip tells the requestor to confirm receipt', () => {
  const { id } = rf.createRequisition(foreman, rfBody([['HDPE-001', 1]]));
  rf.approveRequisition(owner, id);
  const { id: slipId, slipNumber } = slips.prepareSlip(custodian, id);
  const before = countFor('foreman1');
  slips.releaseSlip(custodian, slipId);
  assert.strictEqual(countFor('foreman1'), before + 1);
  assert.strictEqual(latest('foreman1').Message, `${slipNumber} was released. Check the items and confirm receipt.`);
  assert.strictEqual(latest('foreman1').LinkUrl, `/slip.html?id=${slipId}`);
});

test('if the approval is undone, no notification is left behind', () => {
  const { id } = rf.createRequisition(foreman, rfBody([['ACU-001', 1]]));
  const foremanBefore = countFor('foreman1');
  handoffShouldFail = true;
  assert.throws(() => rf.approveRequisition(owner, id), /purchasing is broken/);
  handoffShouldFail = false;
  assert.strictEqual(countFor('foreman1'), foremanBefore);
});

test('counting, reading and marking: only your own notifications', () => {
  const mine = notes.listFor(foreman.id);
  const unread = notes.unreadCount(foreman.id);
  assert.ok(unread > 2);
  notes.markRead(foreman.id, mine[0].NotificationId);
  assert.strictEqual(notes.unreadCount(foreman.id), unread - 1);
  notes.markRead(foreman.id, mine[0].NotificationId); // reading twice is harmless
  assert.strictEqual(notes.unreadCount(foreman.id), unread - 1);

  const someoneElses = notes.listFor(owner.id)[0].NotificationId;
  assert.throws(() => notes.markRead(foreman.id, someoneElses), (e) => e.status === 404);

  assert.strictEqual(notes.markAllRead(foreman.id).marked, unread - 1);
  assert.strictEqual(notes.unreadCount(foreman.id), 0);
  assert.ok(notes.unreadCount(owner.id) > 0, 'other people keep their own unread');
});

test('over the web: login needed, each person sees only their own', async () => {
  assert.strictEqual((await call('GET', '/api/notifications')).status, 401);
  assert.strictEqual((await call('GET', '/api/notifications/count')).status, 401);

  const ownerCookie = await loginAs('owner1');
  const data = await (await call('GET', '/api/notifications', ownerCookie)).json();
  assert.strictEqual(data.unread, notes.unreadCount(owner.id));
  assert.ok(data.items.every((n) => n.Message.length > 0));
  assert.deepStrictEqual((await (await call('GET', '/api/notifications/count', ownerCookie)).json()), { unread: data.unread });

  const first = data.items.find((n) => !n.IsRead);
  assert.strictEqual((await call('POST', `/api/notifications/${first.NotificationId}/read`, ownerCookie)).status, 200);
  const foremanCookie = await loginAs('foreman1');
  assert.strictEqual((await call('POST', `/api/notifications/${data.items[0].NotificationId}/read`, foremanCookie)).status, 404);
  assert.strictEqual((await call('POST', '/api/notifications/abc/read', ownerCookie)).status, 400);
  assert.strictEqual((await call('POST', '/api/notifications/read-all', ownerCookie)).status, 200);
  assert.strictEqual((await (await call('GET', '/api/notifications/count', ownerCookie)).json()).unread, 0);
});
