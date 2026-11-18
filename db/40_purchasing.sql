-- Purchasing module (owner: Member B). Suppliers, prices, purchase requisitions, quotations and purchase orders.
-- Safe to run more than once. Must sort after 10_item.sql, 20_requisition.sql and 30_issuance.sql,
-- since these tables point at Item, Project, Requisition and AppUser.
--
-- Money is whole centavos (PHP 532.66 = 53266). Quantities are numbers with at most 2 decimals.
-- Round at the line total and at the discount (ROUND(x, 2) for quantities, whole centavos for money).
-- Receiving (ReceivingReport and its lines) goes in 50_delivery.sql.

-- A supplier the purchaser can order from. The client approves suppliers; IsApproved records that.
CREATE TABLE IF NOT EXISTS Supplier (
  SupplierId    INTEGER PRIMARY KEY AUTOINCREMENT,
  Name          TEXT NOT NULL UNIQUE,
  ContactPerson TEXT,
  Phone         TEXT,
  Email         TEXT,
  Address       TEXT,
  PaymentTerms  TEXT,
  LeadTimeDays  INTEGER NOT NULL DEFAULT 0 CHECK (LeadTimeDays >= 0),
  Rating        INTEGER CHECK (Rating BETWEEN 1 AND 5),
  IsApproved    INTEGER NOT NULL DEFAULT 1,
  IsActive      INTEGER NOT NULL DEFAULT 1,
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- The agreed unit price of one item from one supplier.
CREATE TABLE IF NOT EXISTS SupplierPrice (
  SupplierPriceId   INTEGER PRIMARY KEY AUTOINCREMENT,
  SupplierId        INTEGER NOT NULL REFERENCES Supplier(SupplierId),
  ItemId            INTEGER NOT NULL REFERENCES Item(ItemId),
  UnitPriceCentavos INTEGER NOT NULL CHECK (UnitPriceCentavos >= 0),
  UpdatedAt         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (SupplierId, ItemId)
);

-- Statuses: pending, approved, on_hold (the owner puts it on hold or returns it), cancelled.
-- A hold or a cancel needs a reason, so the database refuses one without it.
-- RequisitionId is the RF behind the PR; it can be empty for a PR that restocks without an RF.
-- OverBudget and OwnerNote are for the budget check: a PR above the remaining budget is flagged
-- and needs the owner's note.
CREATE TABLE IF NOT EXISTS PurchaseRequisition (
  PurchaseRequisitionId INTEGER PRIMARY KEY AUTOINCREMENT,
  PrNumber      TEXT NOT NULL UNIQUE,
  RequisitionId INTEGER REFERENCES Requisition(RequisitionId),
  ProjectId     INTEGER NOT NULL REFERENCES Project(ProjectId),
  Status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (Status IN ('pending','approved','on_hold','cancelled')),
  Reason        TEXT,
  OverBudget    INTEGER NOT NULL DEFAULT 0,
  OwnerNote     TEXT,
  DecidedBy     INTEGER REFERENCES AppUser(UserId),
  DecidedAt     TEXT,
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UpdatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (Status NOT IN ('on_hold','cancelled') OR length(trim(coalesce(Reason, ''))) > 0)
);

-- One row per short item. SupplierId and UnitPriceCentavos are the supplier and price the purchaser
-- chose; they are set together or not at all.
CREATE TABLE IF NOT EXISTS PRLine (
  PrLineId              INTEGER PRIMARY KEY AUTOINCREMENT,
  PurchaseRequisitionId INTEGER NOT NULL REFERENCES PurchaseRequisition(PurchaseRequisitionId),
  ItemId                INTEGER NOT NULL REFERENCES Item(ItemId),
  ShortQty              REAL NOT NULL CHECK (ShortQty > 0),
  SupplierId            INTEGER REFERENCES Supplier(SupplierId),
  UnitPriceCentavos     INTEGER CHECK (UnitPriceCentavos >= 0),
  UNIQUE (PurchaseRequisitionId, ItemId),
  CHECK ((SupplierId IS NULL) = (UnitPriceCentavos IS NULL))
);

-- A price quoted by one supplier for one PR line. The screen shows the quotations side by side
-- (price, terms, expected arrival). Count the suppliers per PR for the "at least 3 quotations" rule.
CREATE TABLE IF NOT EXISTS Quotation (
  QuotationId         INTEGER PRIMARY KEY AUTOINCREMENT,
  PrLineId            INTEGER NOT NULL REFERENCES PRLine(PrLineId),
  SupplierId          INTEGER NOT NULL REFERENCES Supplier(SupplierId),
  UnitPriceCentavos   INTEGER NOT NULL CHECK (UnitPriceCentavos >= 0),
  Terms               TEXT,
  ExpectedArrivalDate TEXT,
  Note                TEXT,
  QuotedAt            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (PrLineId, SupplierId)
);

-- Statuses: open, partly_delivered, closed.
-- The totals follow the client's sample PO: subtotal of the lines, minus the discount (rounded to the
-- centavo), minus other discounts, plus shipping. The database checks that the saved total adds up.
CREATE TABLE IF NOT EXISTS PurchaseOrder (
  PurchaseOrderId       INTEGER PRIMARY KEY AUTOINCREMENT,
  PoNumber              TEXT NOT NULL UNIQUE,
  PurchaseRequisitionId INTEGER REFERENCES PurchaseRequisition(PurchaseRequisitionId),
  SupplierId            INTEGER NOT NULL REFERENCES Supplier(SupplierId),
  ProjectId             INTEGER NOT NULL REFERENCES Project(ProjectId),
  Status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (Status IN ('open','partly_delivered','closed')),
  PaymentTerms          TEXT,
  ExpectedDeliveryDate  TEXT,
  DeliveryPoint         TEXT,
  DiscountPercent       REAL NOT NULL DEFAULT 0 CHECK (DiscountPercent BETWEEN 0 AND 100),
  OtherDiscountCentavos INTEGER NOT NULL DEFAULT 0 CHECK (OtherDiscountCentavos >= 0),
  ShippingCentavos      INTEGER NOT NULL DEFAULT 0 CHECK (ShippingCentavos >= 0),
  SubtotalCentavos      INTEGER NOT NULL DEFAULT 0 CHECK (SubtotalCentavos >= 0),
  DiscountCentavos      INTEGER NOT NULL DEFAULT 0 CHECK (DiscountCentavos >= 0),
  TotalCentavos         INTEGER NOT NULL DEFAULT 0 CHECK (TotalCentavos >= 0),
  CreatedBy             INTEGER NOT NULL REFERENCES AppUser(UserId),
  CreatedAt             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  SignedBy              INTEGER REFERENCES AppUser(UserId),
  SignedAt              TEXT,
  CHECK (TotalCentavos = SubtotalCentavos - DiscountCentavos - OtherDiscountCentavos + ShippingCentavos)
);

-- QtyReceived is the running total from the receiving reports. Outstanding = Quantity - QtyReceived.
CREATE TABLE IF NOT EXISTS POLine (
  PoLineId          INTEGER PRIMARY KEY AUTOINCREMENT,
  PurchaseOrderId   INTEGER NOT NULL REFERENCES PurchaseOrder(PurchaseOrderId),
  PrLineId          INTEGER REFERENCES PRLine(PrLineId),
  ItemId            INTEGER NOT NULL REFERENCES Item(ItemId),
  Quantity          REAL NOT NULL CHECK (Quantity > 0),
  UnitPriceCentavos INTEGER NOT NULL CHECK (UnitPriceCentavos >= 0),
  LineTotalCentavos INTEGER NOT NULL CHECK (LineTotalCentavos >= 0),
  QtyReceived       REAL NOT NULL DEFAULT 0 CHECK (QtyReceived >= 0),
  UNIQUE (PurchaseOrderId, ItemId),
  CHECK (LineTotalCentavos = CAST(ROUND(Quantity * UnitPriceCentavos) AS INTEGER))
);

CREATE INDEX IF NOT EXISTS IX_PurchaseRequisition_Status ON PurchaseRequisition(Status);
CREATE INDEX IF NOT EXISTS IX_PRLine_PR ON PRLine(PurchaseRequisitionId);
CREATE INDEX IF NOT EXISTS IX_Quotation_PrLine ON Quotation(PrLineId);
CREATE INDEX IF NOT EXISTS IX_PurchaseOrder_Status ON PurchaseOrder(Status);
CREATE INDEX IF NOT EXISTS IX_POLine_PO ON POLine(PurchaseOrderId);

-- Test data: one supplier with the unit prices from the client's sample PO (HDPE-001 to HDPE-006).
-- The client's PO names no supplier, so this one is made up. Replace it once the client names one.
INSERT OR IGNORE INTO Supplier (Name, PaymentTerms, LeadTimeDays)
VALUES ('Sample HDPE Supplier (test data)', '30 days', 30);

WITH price(Code, Centavos) AS (
  VALUES ('HDPE-001', 53266), ('HDPE-002', 169127), ('HDPE-003', 43134),
         ('HDPE-004', 126059), ('HDPE-005', 98641), ('HDPE-006', 230384)
)
INSERT OR IGNORE INTO SupplierPrice (SupplierId, ItemId, UnitPriceCentavos)
SELECT s.SupplierId, i.ItemId, p.Centavos
FROM price p
JOIN Item i ON i.Code = p.Code
JOIN Supplier s ON s.Name = 'Sample HDPE Supplier (test data)';
