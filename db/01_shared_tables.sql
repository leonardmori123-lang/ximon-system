-- Shared tables used by every module. Safe to run more than once.
-- Module tables (Requisition, Item, PurchaseOrder ...) go in their own files: 10_requisition.sql, 20_inventory.sql ...

IF OBJECT_ID('dbo.AppUser', 'U') IS NULL
CREATE TABLE dbo.AppUser (
  UserId       INT IDENTITY(1,1) PRIMARY KEY,
  FullName     NVARCHAR(100) NOT NULL,
  Username     NVARCHAR(50)  NOT NULL UNIQUE,
  PasswordHash NVARCHAR(100) NOT NULL,
  Role         NVARCHAR(20)  NOT NULL CHECK (Role IN ('owner','foreman','custodian','purchaser','verifier')),
  IsActive     BIT           NOT NULL DEFAULT 1,
  CreatedAt    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO

IF OBJECT_ID('dbo.Project', 'U') IS NULL
CREATE TABLE dbo.Project (
  ProjectId              INT IDENTITY(1,1) PRIMARY KEY,
  Code                   NVARCHAR(30)  NOT NULL UNIQUE,
  Name                   NVARCHAR(150) NOT NULL,
  MaterialBudgetCentavos BIGINT        NOT NULL DEFAULT 0,
  Status                 NVARCHAR(20)  NOT NULL DEFAULT 'active'
);
GO

IF OBJECT_ID('dbo.Setting', 'U') IS NULL
CREATE TABLE dbo.Setting (
  SettingKey   NVARCHAR(50)  PRIMARY KEY,
  SettingValue NVARCHAR(100) NOT NULL,
  Description  NVARCHAR(250) NULL
);
GO

IF OBJECT_ID('dbo.NumberSequence', 'U') IS NULL
CREATE TABLE dbo.NumberSequence (
  DocType    NVARCHAR(5) NOT NULL,
  DocYear    INT         NOT NULL,
  LastNumber INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (DocType, DocYear)
);
GO

IF OBJECT_ID('dbo.StatusHistory', 'U') IS NULL
CREATE TABLE dbo.StatusHistory (
  HistoryId  INT IDENTITY(1,1) PRIMARY KEY,
  DocType    NVARCHAR(5)   NOT NULL,
  DocId      INT           NOT NULL,
  FromStatus NVARCHAR(30)  NULL,
  ToStatus   NVARCHAR(30)  NOT NULL,
  ChangedBy  INT           NOT NULL REFERENCES dbo.AppUser(UserId),
  ChangedAt  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Reason     NVARCHAR(300) NULL
);
GO

IF OBJECT_ID('dbo.Attachment', 'U') IS NULL
CREATE TABLE dbo.Attachment (
  AttachmentId INT IDENTITY(1,1) PRIMARY KEY,
  DocType      NVARCHAR(5)   NOT NULL,
  DocId        INT           NOT NULL,
  FilePath     NVARCHAR(300) NOT NULL,
  OriginalName NVARCHAR(200) NOT NULL,
  MimeType     NVARCHAR(100) NULL,
  SizeBytes    INT           NULL,
  UploadedBy   INT           NOT NULL REFERENCES dbo.AppUser(UserId),
  UploadedAt   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO
