// One row per status change for any document: RF (requisition), IS (issuance slip), later PR, PO, RR.
const db = require('../db');

function addDocHistory(docType, docId, from, to, userId, reason) {
  db.run(
    `INSERT INTO StatusHistory (DocType, DocId, FromStatus, ToStatus, ChangedBy, Reason)
     VALUES (@docType, @docId, @from, @to, @userId, @reason)`,
    { docType, docId, from, to, userId, reason }
  );
}

// All status changes of one document, oldest first. The pages show this as the History table.
function getDocHistory(docType, docId) {
  return db.all(
    `SELECT h.FromStatus, h.ToStatus, u.FullName AS ChangedByName, substr(h.ChangedAt, 1, 16) AS ChangedAt, h.Reason
     FROM StatusHistory h JOIN AppUser u ON u.UserId = h.ChangedBy
     WHERE h.DocType = @docType AND h.DocId = @docId ORDER BY h.HistoryId`,
    { docType, docId }
  );
}

module.exports = { addDocHistory, getDocHistory };
