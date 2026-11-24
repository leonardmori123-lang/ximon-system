// Shared test setup: a real in-memory database, five users, and a server on a random port.
process.env.DB_FILE = ':memory:';
process.env.SEED_PASSWORD = 'secret123';
process.env.SESSION_SECRET = 'test';

const { setup } = require('../scripts/setup-db');
setup({ quiet: true });
const db = require('../server/db');
const app = require('../server/index');
const { todayString } = require('../server/services/rfRules');

let server;
let base;

async function start() {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
}
function stop() { server.close(); }

async function loginAs(username, password = 'secret123') {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

function call(method, url, cookie, body) {
  return fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Sends raw text, for testing broken JSON.
function callRaw(method, url, cookie, text) {
  return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: text });
}

// Returns the { id, role } shape a session holds.
function user(username) {
  const row = db.get('SELECT UserId, Role FROM AppUser WHERE Username = @username', { username });
  return { id: row.UserId, role: row.Role };
}
const itemId = (code) => db.get('SELECT ItemId FROM Item WHERE Code = @code', { code }).ItemId;
const item = (code) => ({ ...db.get('SELECT OnHand, Reserved FROM Item WHERE Code = @code', { code }) });
const projectId = () => db.get('SELECT ProjectId FROM Project LIMIT 1').ProjectId;

// A valid requisition body. lines: [['HDPE-001', 3], ['ACU-001', 1]]
function rfBody(lines) {
  return {
    projectId: projectId(), dateNeeded: todayString(), urgency: 'normal', purpose: 'Test requisition',
    lines: lines.map(([code, quantity]) => ({ itemId: itemId(code), quantity })),
  };
}

module.exports = { db, start, stop, loginAs, call, callRaw, user, item, itemId, projectId, rfBody };
