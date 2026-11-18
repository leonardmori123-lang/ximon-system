// The one place that talks to the database. Pages never touch it; they call the server,
// and the server calls these helpers.
// The database is SQLite, built into Node (node:sqlite), so there is nothing to install.
// It is one file: data/ximon.db. Copy that file to back everything up.
const fs = require('node:fs');
const path = require('node:path');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  throw new Error(`This app needs Node.js 22.13 or newer (you have ${process.version}). Install the current LTS from nodejs.org.`);
}

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'ximon.db');

let db;
let inTransaction = false;

function open() {
  if (!db) {
    if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    db = new DatabaseSync(DB_FILE);
    // foreign_keys: SQLite ignores them unless asked. WAL: readers are not blocked by a write.
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  return db;
}

// SQLite cannot bind true/false or undefined, so turn them into 1/0 and null.
function clean(params = {}) {
  const out = {};
  for (const name of Object.keys(params)) {
    let value = params[name];
    if (value === true) value = 1;
    else if (value === false) value = 0;
    else if (value === undefined) value = null;
    out[name] = value;
  }
  return out;
}

// Always pass values as named parameters (@name), never by joining text into the SQL,
// so SQL injection cannot happen. Only pass the parameters the SQL actually uses.
function all(sql, params) { return open().prepare(sql).all(clean(params)); }   // many rows
function get(sql, params) { return open().prepare(sql).get(clean(params)); }   // one row, or undefined
function run(sql, params) {                                                      // INSERT / UPDATE / DELETE
  const result = open().prepare(sql).run(clean(params));
  return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
}
function exec(sql) { open().exec(sql); }                                         // several statements, no values

// Runs several statements as one all-or-nothing unit (stock changes, document numbers).
// SQLite lets only one write transaction run at a time, and this server handles one request
// at a time while it runs, so two people can never reserve the same stock together.
function transaction(work) {
  if (inTransaction) return work();
  const d = open();
  d.exec('BEGIN IMMEDIATE');
  inTransaction = true;
  try {
    const result = work();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    inTransaction = false;
  }
}

function isUniqueError(err) {
  return Boolean(err && err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message));
}

module.exports = { DB_FILE, all, get, run, exec, transaction, isUniqueError };
