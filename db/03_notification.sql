-- Shared: in-app notifications for every module. Safe to run more than once.
-- One row per person who should be told something. ReadAt is empty until they open it.
CREATE TABLE IF NOT EXISTS Notification (
  NotificationId INTEGER PRIMARY KEY AUTOINCREMENT,
  UserId         INTEGER NOT NULL REFERENCES AppUser(UserId),
  Message        TEXT NOT NULL,
  LinkUrl        TEXT,
  CreatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ReadAt         TEXT
);
CREATE INDEX IF NOT EXISTS IX_Notification_User ON Notification (UserId, ReadAt);
