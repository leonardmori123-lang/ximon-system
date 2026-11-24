// Database connection and query helpers for SQLite.
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
    if (DB_FILE !== ':memory:') {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    }
    db = new DatabaseSync(DB_FILE);
    // Enable foreign keys and WAL mode for reliable concurrent reads.
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  return db;
}

// Convert booleans and undefined to SQLite-compatible values (1, 0, null).
function clean(params = {}) {
  const out = {};
  for (const name of Object.keys(params)) {
    let value = params[name];
    if (value === true) {
      value = 1;
    } else if (value === false) {
      value = 0;
    } else if (value === undefined) {
      value = null;
    }
    out[name] = value;
  }
  return out;
}

function all(sql, params) {
  return open().prepare(sql).all(clean(params));
}

function get(sql, params) {
  return open().prepare(sql).get(clean(params));
}

function run(sql, params) {
  const result = open().prepare(sql).run(clean(params));
  return {
    changes: Number(result.changes),
    lastId: Number(result.lastInsertRowid),
  };
}

function exec(sql) {
  open().exec(sql);
}

// Runs work in an immediate transaction so concurrent writes do not conflict.
function transaction(work) {
  if (inTransaction) {
    return work();
  }
  const d = open();
  d.exec('BEGIN IMMEDIATE');
  inTransaction = true;
  try {
    const result = work();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      // Ignore if rollback already happened.
    }
    throw err;
  } finally {
    inTransaction = false;
  }
}

function isUniqueError(err) {
  if (!err) {
    return false;
  }
  return err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message);
}

module.exports = { DB_FILE, all, get, run, exec, transaction, isUniqueError };
