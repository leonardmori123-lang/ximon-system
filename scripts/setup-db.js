// npm run setup-db
// Creates the database if it is missing, runs every file in db/ in order, and adds one
// test user per role. Safe to run again: it never deletes or duplicates anything.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const { makeConfig } = require('../server/db');

const DB_NAME = process.env.DB_NAME || 'XimonDB';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'ximon123';

const SEED_USERS = [
  { username: 'owner1', fullName: 'Test Owner', role: 'owner' },
  { username: 'foreman1', fullName: 'Test Foreman', role: 'foreman' },
  { username: 'custodian1', fullName: 'Test Warehouse Custodian', role: 'custodian' },
  { username: 'purchaser1', fullName: 'Test Purchaser', role: 'purchaser' },
  { username: 'verifier1', fullName: 'Test Delivery Verifier', role: 'verifier' },
];

// SQL Server cannot run "GO" itself (it is a Management Studio word), so split on it.
function splitBatches(text) {
  return text.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean);
}

async function main() {
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('Fill DB_USER and DB_PASSWORD in .env first (copy .env.example to .env).');
  }
  if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) throw new Error('DB_NAME may only use letters, digits and _.');

  const master = await new sql.ConnectionPool(makeConfig('master')).connect();
  await master.request().batch(`IF DB_ID(N'${DB_NAME}') IS NULL CREATE DATABASE [${DB_NAME}]`);
  await master.close();
  console.log(`Database ${DB_NAME} is ready.`);

  const pool = await new sql.ConnectionPool(makeConfig(DB_NAME)).connect();
  const dir = path.join(__dirname, '..', 'db');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const batch of splitBatches(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      await pool.request().batch(batch);
    }
    console.log(`Ran ${file}`);
  }

  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  for (const user of SEED_USERS) {
    await pool
      .request()
      .input('username', sql.NVarChar(50), user.username)
      .input('fullName', sql.NVarChar(100), user.fullName)
      .input('hash', sql.NVarChar(100), hash)
      .input('role', sql.NVarChar(20), user.role)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.AppUser WHERE Username = @username)
                INSERT INTO dbo.AppUser (FullName, Username, PasswordHash, Role)
                VALUES (@fullName, @username, @hash, @role)`);
  }
  console.log(`Test users ready: ${SEED_USERS.map((u) => u.username).join(', ')}`);
  await pool.close();
  console.log('Setup finished.');
}

module.exports = { splitBatches };

if (require.main === module) {
  main().catch((err) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
  });
}
