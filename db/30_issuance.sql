-- Inventory module (owner: Leo): stock transactions and issuance slips. Safe to run more than once.

-- One row for every change to OnHand. Quantity is the change: negative = stock goes out, positive = comes in.
-- Reservations are not stock movements, so they are not logged here.
CREATE TABLE IF NOT EXISTS StockTransaction (
  TransactionId INTEGER PRIMARY KEY AUTOINCREMENT,
  ItemId        INTEGER NOT NULL REFERENCES Item(ItemId),
  TxType        TEXT NOT NULL CHECK (TxType IN ('opening','receipt','issue','return','adjustment')),
  Quantity      REAL NOT NULL CHECK (Quantity <> 0),
  RefDocType    TEXT,
  RefDocId      INTEGER,
  ProjectId     INTEGER REFERENCES Project(ProjectId),
  CreatedBy     INTEGER NOT NULL REFERENCES AppUser(UserId),
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  Note          TEXT
);

CREATE TABLE IF NOT EXISTS IssuanceSlip (
  SlipId         INTEGER PRIMARY KEY AUTOINCREMENT,
  SlipNumber     TEXT NOT NULL UNIQUE,
  RequisitionId  INTEGER NOT NULL REFERENCES Requisition(RequisitionId),
  Status         TEXT NOT NULL DEFAULT 'prepared'
                 CHECK (Status IN ('prepared','released','acknowledged','cancelled')),
  PreparedBy     INTEGER NOT NULL REFERENCES AppUser(UserId),
  PreparedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ReleasedBy     INTEGER REFERENCES AppUser(UserId),
  ReleasedAt     TEXT,
  AcknowledgedBy INTEGER REFERENCES AppUser(UserId),
  AcknowledgedAt TEXT,
  Remarks        TEXT
);

CREATE TABLE IF NOT EXISTS IssuanceLine (
  SlipLineId        INTEGER PRIMARY KEY AUTOINCREMENT,
  SlipId            INTEGER NOT NULL REFERENCES IssuanceSlip(SlipId),
  RequisitionLineId INTEGER NOT NULL REFERENCES RequisitionLine(LineId),
  ItemId            INTEGER NOT NULL REFERENCES Item(ItemId),
  Quantity          REAL NOT NULL CHECK (Quantity > 0)
);
