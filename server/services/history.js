// One row per status change for any document: RF (requisition), IS (issuance slip), later PR, PO, RR.
const { sql } = require('../db');

async function addDocHistory(tx, docType, docId, from, to, userId, reason) {
  await new sql.Request(tx)
    .input('docType', sql.NVarChar(5), docType)
    .input('id', sql.Int, docId)
    .input('from', sql.NVarChar(30), from)
    .input('to', sql.NVarChar(30), to)
    .input('userId', sql.Int, userId)
    .input('reason', sql.NVarChar(300), reason)
    .query(`INSERT INTO dbo.StatusHistory (DocType, DocId, FromStatus, ToStatus, ChangedBy, Reason)
            VALUES (@docType, @id, @from, @to, @userId, @reason)`);
}

module.exports = { addDocHistory };
