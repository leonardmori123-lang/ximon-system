// The one place that talks to SQL Server. Pages never touch the database;
// they call the server, and the server calls these helpers.
const sql = require('mssql');

function makeConfig(database = process.env.DB_NAME || 'XimonDB') {
  return {
    server: process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT || 1433),
    database,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true }, // local SQL Server Express
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

let pool;
async function getPool() {
  if (!pool) pool = await new sql.ConnectionPool(makeConfig()).connect();
  return pool;
}

// Run one statement with named parameters: query('SELECT * FROM Item WHERE Code = @code', { code })
// Always pass values as parameters, never by joining text, so SQL injection cannot happen.
async function query(text, params = {}) {
  const request = (await getPool()).request();
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  const result = await request.query(text);
  return result.recordset;
}

// Run several statements as one all-or-nothing unit (stock changes, document numbers).
// work(tx) receives the transaction: new sql.Request(tx).input(...).query(...)
async function withTransaction(work) {
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw err;
  }
}

module.exports = { sql, makeConfig, query, withTransaction };
