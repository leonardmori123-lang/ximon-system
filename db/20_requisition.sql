-- Requisition module (owner: Leo). Safe to run more than once.
-- This file must sort after 10_item.sql because RequisitionLine points at Item.

IF OBJECT_ID('dbo.Requisition', 'U') IS NULL
CREATE TABLE dbo.Requisition (
  RequisitionId INT IDENTITY(1,1) PRIMARY KEY,
  RfNumber      NVARCHAR(20)  NOT NULL UNIQUE,
  ProjectId     INT           NOT NULL REFERENCES dbo.Project(ProjectId),
  RequestedBy   INT           NOT NULL REFERENCES dbo.AppUser(UserId),
  DateNeeded    DATE          NOT NULL,
  Urgency       NVARCHAR(10)  NOT NULL CHECK (Urgency IN ('low','normal','high','urgent')),
  Purpose       NVARCHAR(300) NOT NULL,
  Status        NVARCHAR(20)  NOT NULL DEFAULT 'pending'
                CHECK (Status IN ('pending','approved','returned','cancelled','partly_fulfilled','fulfilled')),
  ReturnReason  NVARCHAR(300) NULL,
  RevisionCount INT           NOT NULL DEFAULT 0,
  DecidedBy     INT           NULL REFERENCES dbo.AppUser(UserId),
  DecidedAt     DATETIME2     NULL,
  CreatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  UpdatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO

IF OBJECT_ID('dbo.RequisitionLine', 'U') IS NULL
CREATE TABLE dbo.RequisitionLine (
  LineId        INT IDENTITY(1,1) PRIMARY KEY,
  RequisitionId INT           NOT NULL REFERENCES dbo.Requisition(RequisitionId),
  ItemId        INT           NOT NULL REFERENCES dbo.Item(ItemId),
  Quantity      DECIMAL(12,2) NOT NULL CHECK (Quantity > 0),
  QtyReserved   DECIMAL(12,2) NOT NULL DEFAULT 0,
  QtyShort      DECIMAL(12,2) NOT NULL DEFAULT 0,
  QtyIssued     DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT UQ_RequisitionLine_Item UNIQUE (RequisitionId, ItemId)
);
GO
