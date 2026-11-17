-- Shared tables used by every module. Safe to run more than once.
-- Module tables go in their own files: 10_item.sql, 20_requisition.sql, 30_issuance.sql, 40_purchasing.sql ...
-- Money is whole centavos. Quantities are numbers rounded to 2 decimals. Dates are text: 2026-11-17 or 2026-11-17 09:30:00.

CREATE TABLE IF NOT EXISTS AppUser (
  UserId       INTEGER PRIMARY KEY AUTOINCREMENT,
  FullName     TEXT NOT NULL,
  Username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  PasswordHash TEXT NOT NULL,
  Role         TEXT NOT NULL CHECK (Role IN ('owner','foreman','custodian','purchaser','verifier')),
  IsActive     INTEGER NOT NULL DEFAULT 1,
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS Project (
  ProjectId              INTEGER PRIMARY KEY AUTOINCREMENT,
  Code                   TEXT NOT NULL UNIQUE,
  Name                   TEXT NOT NULL,
  MaterialBudgetCentavos INTEGER NOT NULL DEFAULT 0,
  Status                 TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS Setting (
  SettingKey   TEXT PRIMARY KEY,
  SettingValue TEXT NOT NULL,
  Description  TEXT
);

CREATE TABLE IF NOT EXISTS NumberSequence (
  DocType    TEXT NOT NULL,
  DocYear    INTEGER NOT NULL,
  LastNumber INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (DocType, DocYear)
);

CREATE TABLE IF NOT EXISTS StatusHistory (
  HistoryId  INTEGER PRIMARY KEY AUTOINCREMENT,
  DocType    TEXT NOT NULL,
  DocId      INTEGER NOT NULL,
  FromStatus TEXT,
  ToStatus   TEXT NOT NULL,
  ChangedBy  INTEGER NOT NULL REFERENCES AppUser(UserId),
  ChangedAt  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  Reason     TEXT
);

CREATE TABLE IF NOT EXISTS Attachment (
  AttachmentId INTEGER PRIMARY KEY AUTOINCREMENT,
  DocType      TEXT NOT NULL,
  DocId        INTEGER NOT NULL,
  FilePath     TEXT NOT NULL,
  OriginalName TEXT NOT NULL,
  MimeType     TEXT,
  SizeBytes    INTEGER,
  UploadedBy   INTEGER NOT NULL REFERENCES AppUser(UserId),
  UploadedAt   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
