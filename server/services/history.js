// Audit trail of document status changes.
const db = require('../db');

function addDocHistory(docType, docId, from, to, userId, reason) {
  db.run(
    `INSERT INTO StatusHistory (DocType, DocId, FromStatus, ToStatus, ChangedBy, Reason)
     VALUES (@docType, @docId, @from, @to, @userId, @reason)`,
    { docType, docId, from, to, userId, reason }
  );
}

// Returns all status changes for a document, ordered oldest to newest.
function getDocHistory(docType, docId) {
  return db.all(
    `SELECT h.FromStatus, h.ToStatus, u.FullName AS ChangedByName, substr(h.ChangedAt, 1, 16) AS ChangedAt, h.Reason
     FROM StatusHistory h JOIN AppUser u ON u.UserId = h.ChangedBy
     WHERE h.DocType = @docType AND h.DocId = @docId ORDER BY h.HistoryId`,
    { docType, docId }
  );
}

module.exports = { addDocHistory, getDocHistory };
