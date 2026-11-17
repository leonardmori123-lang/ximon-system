// One row per status change for any document: RF (requisition), IS (issuance slip), later PR, PO, RR.
const db = require('../db');

function addDocHistory(docType, docId, from, to, userId, reason) {
  db.run(
    `INSERT INTO StatusHistory (DocType, DocId, FromStatus, ToStatus, ChangedBy, Reason)
     VALUES (@docType, @docId, @from, @to, @userId, @reason)`,
    { docType, docId, from, to, userId, reason }
  );
}

module.exports = { addDocHistory };
