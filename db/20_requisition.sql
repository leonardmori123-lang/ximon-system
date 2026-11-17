-- Requisition module (owner: Leo). Safe to run more than once.
-- Files run in name order, so this one comes after 10_item.sql.

CREATE TABLE IF NOT EXISTS Requisition (
  RequisitionId INTEGER PRIMARY KEY AUTOINCREMENT,
  RfNumber      TEXT NOT NULL UNIQUE,
  ProjectId     INTEGER NOT NULL REFERENCES Project(ProjectId),
  RequestedBy   INTEGER NOT NULL REFERENCES AppUser(UserId),
  DateNeeded    TEXT NOT NULL,
  Urgency       TEXT NOT NULL CHECK (Urgency IN ('low','normal','high','urgent')),
  Purpose       TEXT NOT NULL,
  Status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (Status IN ('pending','approved','returned','cancelled','partly_fulfilled','fulfilled')),
  ReturnReason  TEXT,
  RevisionCount INTEGER NOT NULL DEFAULT 0,
  DecidedBy     INTEGER REFERENCES AppUser(UserId),
  DecidedAt     TEXT,
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UpdatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS RequisitionLine (
  LineId        INTEGER PRIMARY KEY AUTOINCREMENT,
  RequisitionId INTEGER NOT NULL REFERENCES Requisition(RequisitionId),
  ItemId        INTEGER NOT NULL REFERENCES Item(ItemId),
  Quantity      REAL NOT NULL CHECK (Quantity > 0),
  QtyReserved   REAL NOT NULL DEFAULT 0,
  QtyShort      REAL NOT NULL DEFAULT 0,
  QtyIssued     REAL NOT NULL DEFAULT 0,
  UNIQUE (RequisitionId, ItemId)
);
