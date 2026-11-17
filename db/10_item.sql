-- Inventory module (owner: Leo). Item list. Safe to run more than once.
-- Quantities change only through stock transactions, so the screens never edit OnHand or Reserved directly.
-- Every update rounds to 2 decimals (ROUND(x, 2)) so 0.1 + 0.2 is exactly 0.3 and the checks below never trip.

CREATE TABLE IF NOT EXISTS Item (
  ItemId       INTEGER PRIMARY KEY AUTOINCREMENT,
  Code         TEXT NOT NULL UNIQUE,
  Description  TEXT NOT NULL,
  Unit         TEXT NOT NULL,
  Location     TEXT,
  OnHand       REAL NOT NULL DEFAULT 0 CHECK (OnHand >= 0),
  Reserved     REAL NOT NULL DEFAULT 0 CHECK (Reserved >= 0),
  ReorderPoint REAL NOT NULL DEFAULT 0,
  LeadTimeDays INTEGER NOT NULL DEFAULT 0,
  IsTool       INTEGER NOT NULL DEFAULT 0,
  IsActive     INTEGER NOT NULL DEFAULT 1,
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (Reserved <= OnHand)
);

-- Sample items from the client's PO and BOQ. Stock, location, reorder point and lead time are
-- test values only (HDPE-001 starts with 10 so the "stock is enough" path can be tried;
-- ACU-001 starts at 0 as in Walkthrough A).
INSERT OR IGNORE INTO Item (Code, Description, Unit, Location, OnHand, ReorderPoint, LeadTimeDays) VALUES
  ('HDPE-001', 'HDPE Buttfusion Tee 63mm', 'pc', 'Warehouse', 10, 2, 30),
  ('HDPE-002', 'HDPE Buttfusion Reducing Tee 110mm x 63mm x 110mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-003', 'HDPE Buttfusion Elbow 90 deg. 63mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-004', 'HDPE Buttfusion Elbow 90 deg. 90mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-005', 'HDPE Buttfusion Elbow 45 deg. 63mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-006', 'HDPE Buttfusion Elbow 45 deg. 110mm', 'pc', 'Warehouse', 0, 2, 30),
  ('ACU-001',  'Aircon Condensate Drain Pump', 'pc', 'Warehouse', 0, 1, 7);
