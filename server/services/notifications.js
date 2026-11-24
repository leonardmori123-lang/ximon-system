// In-app notifications for users and roles.
const db = require('../db');
const { HttpError } = require('./errors');

function notifyUser(userId, message, linkUrl) {
  db.run('INSERT INTO Notification (UserId, Message, LinkUrl) VALUES (@userId, @message, @linkUrl)', {
    userId,
    message,
    linkUrl: linkUrl || null,
  });
}

function notifyRole(role, message, linkUrl) {
  const users = db.all('SELECT UserId FROM AppUser WHERE Role = @role AND IsActive = 1', { role });
  for (const person of users) {
    notifyUser(person.UserId, message, linkUrl);
  }
}

function unreadCount(userId) {
  const row = db.get('SELECT COUNT(*) AS n FROM Notification WHERE UserId = @userId AND ReadAt IS NULL', { userId });
  return row.n;
}

function listFor(userId, limit = 50) {
  return db.all(
    `SELECT NotificationId, Message, LinkUrl, substr(CreatedAt, 1, 16) AS CreatedAt, ReadAt IS NOT NULL AS IsRead
     FROM Notification WHERE UserId = @userId ORDER BY NotificationId DESC LIMIT @limit`,
    { userId, limit }
  );
}

// Users can only mark their own notifications as read.
function markRead(userId, id) {
  const result = db.run(
    `UPDATE Notification SET ReadAt = datetime('now','localtime')
     WHERE NotificationId = @id AND UserId = @userId AND ReadAt IS NULL`,
    { id, userId }
  );
  if (result.changes === 0) {
    const mine = db.get('SELECT 1 AS ok FROM Notification WHERE NotificationId = @id AND UserId = @userId', { id, userId });
    if (!mine) {
      throw new HttpError(404, 'Notification not found.');
    }
  }
}

function markAllRead(userId) {
  const result = db.run(
    `UPDATE Notification SET ReadAt = datetime('now','localtime') WHERE UserId = @userId AND ReadAt IS NULL`,
    { userId }
  );
  return { marked: result.changes };
}

module.exports = { notifyUser, notifyRole, unreadCount, listFor, markRead, markAllRead };
