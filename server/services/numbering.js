// Document numbers: RF-2026-0001, IS-..., later PR, PO, RR.
// Call it inside db.transaction() so the number is taken in the same transaction that saves
// the document; two people can then never get the same number.
const db = require('../db');

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
