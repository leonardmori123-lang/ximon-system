// Sequential document number generation.
const db = require('../db');

// Call inside a transaction so concurrent requests do not receive the same number.
function nextNumber(docType, year = new Date().getFullYear()) {
  db.run('INSERT OR IGNORE INTO NumberSequence (DocType, DocYear, LastNumber) VALUES (@docType, @year, 0)', { docType, year });
  const row = db.get(
    `UPDATE NumberSequence SET LastNumber = LastNumber + 1
     WHERE DocType = @docType AND DocYear = @year RETURNING LastNumber`,
    { docType, year }
  );
  return `${docType}-${year}-${String(row.LastNumber).padStart(4, '0')}`;
}

module.exports = { nextNumber };
