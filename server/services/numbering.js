// Document numbers: RF-2026-0001, PR-..., PO-..., RR-..., IS-...
// Call inside withTransaction so the number is taken in the same transaction
// that saves the document; two users can then never get the same number.
const { sql } = require('../db');

async function nextNumber(tx, docType, year = new Date().getFullYear()) {
  const result = await new sql.Request(tx)
    .input('docType', sql.NVarChar(5), docType)
    .input('year', sql.Int, year)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM NumberSequence WITH (UPDLOCK, HOLDLOCK)
                     WHERE DocType = @docType AND DocYear = @year)
        INSERT INTO NumberSequence (DocType, DocYear, LastNumber) VALUES (@docType, @year, 0);
      UPDATE NumberSequence SET LastNumber = LastNumber + 1
        OUTPUT inserted.LastNumber AS n
        WHERE DocType = @docType AND DocYear = @year;`);
  const n = result.recordset[0].n;
  return `${docType}-${year}-${String(n).padStart(4, '0')}`;
}

module.exports = { nextNumber };
