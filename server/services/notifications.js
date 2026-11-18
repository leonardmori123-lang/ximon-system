// In-app notifications, shared by every module.
//
//   notifyUser(userId, 'RF-2026-0001 was approved.', '/requisition.html?id=1')
//   notifyRole('owner', 'RF-2026-0002 needs your approval.', '/requisition.html?id=2')   // every active owner
//
// Call them inside the same db.transaction() as the change they announce, so a notification is
// never saved for something that was undone. Purchasing: call notifyRole('purchaser', ...) from
// createPurchaseRequisition in handoff.js, and later for late deliveries and discrepancies.
const db = require('../db');
const { HttpError } = require('./errors');

function notifyUser(userId, message, linkUrl) {
  db.run('INSERT INTO Notification (UserId, Message, LinkUrl) VALUES (@userId, @message, @linkUrl)',
    { userId, message, linkUrl: linkUrl || null });
}

function notifyRole(role, message, linkUrl) {
  for (const person of db.all('SELECT UserId FROM AppUser WHERE Role = @role AND IsActive = 1', { role })) {
    notifyUser(person.UserId, message, linkUrl);
  }
}

function unreadCount(userId) {
  return db.get('SELECT COUNT(*) AS n FROM Notification WHERE UserId = @userId AND ReadAt IS NULL', { userId }).n;
}

function listFor(userId, limit = 50) {
  return db.all(
    `SELECT NotificationId, Message, LinkUrl, substr(CreatedAt, 1, 16) AS CreatedAt, ReadAt IS NOT NULL AS IsRead
     FROM Notification WHERE UserId = @userId ORDER BY NotificationId DESC LIMIT @limit`,
    { userId, limit }
  );
}

// People can only read their own notifications.
function markRead(userId, id) {
  const { changes } = db.run(
    `UPDATE Notification SET ReadAt = datetime('now','localtime')
     WHERE NotificationId = @id AND UserId = @userId AND ReadAt IS NULL`,
    { id, userId }
  );
  if (changes === 0 && !db.get('SELECT 1 AS ok FROM Notification WHERE NotificationId = @id AND UserId = @userId', { id, userId })) {
    throw new HttpError(404, 'Notification not found.');
  }
}

function markAllRead(userId) {
  return { marked: db.run(
    `UPDATE Notification SET ReadAt = datetime('now','localtime') WHERE UserId = @userId AND ReadAt IS NULL`,
    { userId }
  ).changes };
}

module.exports = { notifyUser, notifyRole, unreadCount, listFor, markRead, markAllRead };
