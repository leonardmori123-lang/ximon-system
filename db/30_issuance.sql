-- Inventory module (owner: Leo): stock transactions and issuance slips. Safe to run more than once.
-- Must sort after 10_item.sql and 20_requisition.sql.

-- One row for every change to OnHand. Quantity is the change: negative = stock goes out, positive = comes in.
-- Reservations are not stock movements, so they are not logged here.
IF OBJECT_ID('dbo.StockTransaction', 'U') IS NULL
CREATE TABLE dbo.StockTransaction (
  TransactionId INT IDENTITY(1,1) PRIMARY KEY,
  ItemId        INT           NOT NULL REFERENCES dbo.Item(ItemId),
  TxType        NVARCHAR(12)  NOT NULL CHECK (TxType IN ('opening','receipt','issue','return','adjustment')),
  Quantity      DECIMAL(12,2) NOT NULL CHECK (Quantity <> 0),
  RefDocType    NVARCHAR(5)   NULL,
  RefDocId      INT           NULL,
  ProjectId     INT           NULL REFERENCES dbo.Project(ProjectId),
  CreatedBy     INT           NOT NULL REFERENCES dbo.AppUser(UserId),
  CreatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Note          NVARCHAR(200) NULL
);
GO

IF OBJECT_ID('dbo.IssuanceSlip', 'U') IS NULL
CREATE TABLE dbo.IssuanceSlip (
  SlipId         INT IDENTITY(1,1) PRIMARY KEY,
  SlipNumber     NVARCHAR(20) NOT NULL UNIQUE,
  RequisitionId  INT          NOT NULL REFERENCES dbo.Requisition(RequisitionId),
  Status         NVARCHAR(15) NOT NULL DEFAULT 'prepared'
                 CHECK (Status IN ('prepared','released','acknowledged','cancelled')),
  PreparedBy     INT          NOT NULL REFERENCES dbo.AppUser(UserId),
  PreparedAt     DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
  ReleasedBy     INT          NULL REFERENCES dbo.AppUser(UserId),
  ReleasedAt     DATETIME2    NULL,
  AcknowledgedBy INT          NULL REFERENCES dbo.AppUser(UserId),
  AcknowledgedAt DATETIME2    NULL,
  Remarks        NVARCHAR(200) NULL
);
GO

IF OBJECT_ID('dbo.IssuanceLine', 'U') IS NULL
CREATE TABLE dbo.IssuanceLine (
  SlipLineId        INT IDENTITY(1,1) PRIMARY KEY,
  SlipId            INT           NOT NULL REFERENCES dbo.IssuanceSlip(SlipId),
  RequisitionLineId INT           NOT NULL REFERENCES dbo.RequisitionLine(LineId),
  ItemId            INT           NOT NULL REFERENCES dbo.Item(ItemId),
  Quantity          DECIMAL(12,2) NOT NULL CHECK (Quantity > 0)
);
GO

-- Items that already had stock before the log existed get one "opening" row, so the log adds up to OnHand.
INSERT INTO dbo.StockTransaction (ItemId, TxType, Quantity, CreatedBy, Note)
SELECT i.ItemId, 'opening', i.OnHand, (SELECT MIN(UserId) FROM dbo.AppUser), 'Opening balance'
FROM dbo.Item i
WHERE i.OnHand > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.StockTransaction t WHERE t.ItemId = i.ItemId);
GO
