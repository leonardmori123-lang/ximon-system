// npm run setup-db
// Creates the database file (data/ximon.db) if it is missing, runs every file in db/ in order,
// and adds one test user per role. Safe to run again: it never deletes or duplicates anything.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../server/db');

const SEED_USERS = [
  { username: 'owner1', fullName: 'Test Owner', role: 'owner' },
  { username: 'foreman1', fullName: 'Test Foreman', role: 'foreman' },
  { username: 'custodian1', fullName: 'Test Warehouse Custodian', role: 'custodian' },
  { username: 'purchaser1', fullName: 'Test Purchaser', role: 'purchaser' },
  { username: 'verifier1', fullName: 'Test Delivery Verifier', role: 'verifier' },
];

function setup({ quiet = false } = {}) {
  const say = (text) => { if (!quiet) console.log(text); };
  const seedPassword = process.env.SEED_PASSWORD || 'ximon123';

  const dir = path.join(__dirname, '..', 'db');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
    say(`Ran ${file}`);
  }

  const hash = bcrypt.hashSync(seedPassword, 10);
  for (const user of SEED_USERS) {
    db.run(
      `INSERT OR IGNORE INTO AppUser (FullName, Username, PasswordHash, Role)
       VALUES (@fullName, @username, @hash, @role)`,
      { fullName: user.fullName, username: user.username, hash, role: user.role }
    );
  }
  say(`Test users ready: ${SEED_USERS.map((u) => u.username).join(', ')}`);

  // Items that already have stock but no stock transactions get one "opening" row,
  // so the stock log always adds up to the Item list.
  const firstUser = db.get('SELECT MIN(UserId) AS id FROM AppUser').id;
  db.run(
    `INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy, Note)
     SELECT i.ItemId, 'opening', i.OnHand, @userId, 'Opening balance'
     FROM Item i
     WHERE i.OnHand > 0 AND NOT EXISTS (SELECT 1 FROM StockTransaction t WHERE t.ItemId = i.ItemId)`,
    { userId: firstUser }
  );
}

module.exports = { setup };

if (require.main === module) {
  try {
    setup();
    console.log(`Setup finished. Database file: ${db.DB_FILE}`);
  } catch (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  }
}
