-- Inventory module (owner: Leo). Item list. Safe to run more than once.
-- Quantities change only through stock transactions (built in the next phase),
-- so the screens never edit OnHand or Reserved directly.

IF OBJECT_ID('dbo.Item', 'U') IS NULL
CREATE TABLE dbo.Item (
  ItemId       INT IDENTITY(1,1) PRIMARY KEY,
  Code         NVARCHAR(30)  NOT NULL UNIQUE,
  Description  NVARCHAR(200) NOT NULL,
  Unit         NVARCHAR(20)  NOT NULL,
  Location     NVARCHAR(60)  NULL,
  OnHand       DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (OnHand >= 0),
  Reserved     DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (Reserved >= 0),
  ReorderPoint DECIMAL(12,2) NOT NULL DEFAULT 0,
  LeadTimeDays INT           NOT NULL DEFAULT 0,
  IsTool       BIT           NOT NULL DEFAULT 0,
  IsActive     BIT           NOT NULL DEFAULT 1,
  CreatedAt    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  CONSTRAINT CK_Item_Reserved_Within_OnHand CHECK (Reserved <= OnHand)
);
GO

-- Sample items from the client's PO and BOQ. Stock, location, reorder point and lead time are
-- test values only (HDPE-001 starts with 10 so the "stock is enough" path can be tried;
-- ACU-001 starts at 0 as in Walkthrough A).
INSERT INTO dbo.Item (Code, Description, Unit, Location, OnHand, ReorderPoint, LeadTimeDays)
SELECT v.Code, v.Description, v.Unit, v.Location, v.OnHand, v.ReorderPoint, v.LeadTimeDays
FROM (VALUES
  ('HDPE-001', N'HDPE Buttfusion Tee 63mm', 'pc', 'Warehouse', 10, 2, 30),
  ('HDPE-002', N'HDPE Buttfusion Reducing Tee 110mm x 63mm x 110mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-003', N'HDPE Buttfusion Elbow 90 deg. 63mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-004', N'HDPE Buttfusion Elbow 90 deg. 90mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-005', N'HDPE Buttfusion Elbow 45 deg. 63mm', 'pc', 'Warehouse', 0, 2, 30),
  ('HDPE-006', N'HDPE Buttfusion Elbow 45 deg. 110mm', 'pc', 'Warehouse', 0, 2, 30),
  ('ACU-001',  N'Aircon Condensate Drain Pump', 'pc', 'Warehouse', 0, 1, 7)
) AS v (Code, Description, Unit, Location, OnHand, ReorderPoint, LeadTimeDays)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Item i WHERE i.Code = v.Code);
GO
