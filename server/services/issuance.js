// Release side of Inventory, following the flowchart:
//   Stock issuance slip (prepared for release) -> Deliver / issue items to requestor
//   -> Signed acknowledgment (verified by requestor) -> Deduct issued quantities and close requisition.
// Stock is deducted only when the requestor confirms receipt.
const { sql, query, withTransaction } = require('../db');
const { nextNumber } = require('./numbering');
const { addDocHistory } = require('./history');
const { HttpError } = require('./errors');

const SLIP_STATUSES = ['prepared', 'released', 'acknowledged', 'cancelled'];

const SLIP_HEADER_SQL = `
  SELECT s.SlipId, s.SlipNumber, s.Status, s.RequisitionId, r.RfNumber, r.RequestedBy, r.Purpose,
         p.Code AS ProjectCode, p.Name AS ProjectName, u.FullName AS RequestedByName,
         pb.FullName AS PreparedByName, CONVERT(varchar(16), s.PreparedAt, 120) AS PreparedAt,
         rb.FullName AS ReleasedByName, CONVERT(varchar(16), s.ReleasedAt, 120) AS ReleasedAt,
         ab.FullName AS AcknowledgedByName, CONVERT(varchar(16), s.AcknowledgedAt, 120) AS AcknowledgedAt,
         s.Remarks
  FROM dbo.IssuanceSlip s
  JOIN dbo.Requisition r ON r.RequisitionId = s.RequisitionId
  JOIN dbo.Project p ON p.ProjectId = r.ProjectId
  JOIN dbo.AppUser u ON u.UserId = r.RequestedBy
  JOIN dbo.AppUser pb ON pb.UserId = s.PreparedBy
  LEFT JOIN dbo.AppUser rb ON rb.UserId = s.ReleasedBy
  LEFT JOIN dbo.AppUser ab ON ab.UserId = s.AcknowledgedBy`;

function assertCanView(user, slip) {
  if (user.role === 'owner' || user.role === 'custodian') return;
  if (user.role === 'foreman' && slip.RequestedBy === user.id) return;
  throw new HttpError(403, 'You cannot open this slip.');
}

// Approved requisitions that have reserved items waiting and no open slip yet.
async function listReleasable() {
  return query(`
    SELECT r.RequisitionId, r.RfNumber, p.Code AS ProjectCode, u.FullName AS RequestedByName,
           CONVERT(varchar(10), r.DateNeeded, 23) AS DateNeeded, r.Urgency, COUNT(*) AS LinesToRelease
    FROM dbo.Requisition r
    JOIN dbo.Project p ON p.ProjectId = r.ProjectId
    JOIN dbo.AppUser u ON u.UserId = r.RequestedBy
    JOIN dbo.RequisitionLine l ON l.RequisitionId = r.RequisitionId AND l.QtyReserved - l.QtyIssued > 0
    WHERE r.Status IN ('approved', 'partly_fulfilled')
      AND NOT EXISTS (SELECT 1 FROM dbo.IssuanceSlip s
                      WHERE s.RequisitionId = r.RequisitionId AND s.Status IN ('prepared', 'released'))
    GROUP BY r.RequisitionId, r.RfNumber, p.Code, u.FullName, r.DateNeeded, r.Urgency
    ORDER BY r.RequisitionId`);
}

async function listSlips(user, status) {
  if (status && !SLIP_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  const where = [];
  const params = {};
  if (status) { where.push('s.Status = @status'); params.status = status; }
  if (user.role === 'foreman') { where.push('r.RequestedBy = @userId'); params.userId = user.id; }
  return query(
    `SELECT s.SlipId, s.SlipNumber, s.Status, r.RequisitionId, r.RfNumber, p.Code AS ProjectCode,
            u.FullName AS RequestedByName, CONVERT(varchar(16), s.PreparedAt, 120) AS PreparedAt,
            (SELECT COUNT(*) FROM dbo.IssuanceLine x WHERE x.SlipId = s.SlipId) AS LineCount
     FROM dbo.IssuanceSlip s
     JOIN dbo.Requisition r ON r.RequisitionId = s.RequisitionId
     JOIN dbo.Project p ON p.ProjectId = r.ProjectId
     JOIN dbo.AppUser u ON u.UserId = r.RequestedBy
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.SlipId DESC`,
    params
  );
}

async function getSlip(user, id) {
  const rows = await query(`${SLIP_HEADER_SQL} WHERE s.SlipId = @id`, { id });
  if (!rows.length) throw new HttpError(404, 'Slip not found.');
  const slip = rows[0];
  assertCanView(user, slip);
  slip.lines = await query(
    `SELECT l.SlipLineId, i.Code, i.Description, i.Unit, l.Quantity
     FROM dbo.IssuanceLine l JOIN dbo.Item i ON i.ItemId = l.ItemId
     WHERE l.SlipId = @id ORDER BY l.SlipLineId`,
    { id }
  );
  slip.history = await query(
    `SELECT h.FromStatus, h.ToStatus, u.FullName AS ChangedByName,
            CONVERT(varchar(16), h.ChangedAt, 120) AS ChangedAt, h.Reason
     FROM dbo.StatusHistory h JOIN dbo.AppUser u ON u.UserId = h.ChangedBy
     WHERE h.DocType = 'IS' AND h.DocId = @id ORDER BY h.HistoryId`,
    { id }
  );
  return slip;
}

// The warehouse prepares a slip for everything reserved and not yet issued on one requisition.
async function prepareSlip(user, requisitionId) {
  return withTransaction(async (tx) => {
    const rf = (
      await new sql.Request(tx)
        .input('id', sql.Int, requisitionId)
        .query('SELECT Status FROM dbo.Requisition WITH (UPDLOCK, ROWLOCK) WHERE RequisitionId = @id')
    ).recordset[0];
    if (!rf) throw new HttpError(404, 'Requisition not found.');
    if (!['approved', 'partly_fulfilled'].includes(rf.Status)) {
      throw new HttpError(409, 'Only an approved requisition can get an issuance slip.');
    }
    const open = (
      await new sql.Request(tx)
        .input('id', sql.Int, requisitionId)
        .query(`SELECT SlipNumber FROM dbo.IssuanceSlip WHERE RequisitionId = @id AND Status IN ('prepared', 'released')`)
    ).recordset;
    if (open.length) throw new HttpError(409, `${open[0].SlipNumber} is still open for this requisition.`);

    const lines = (
      await new sql.Request(tx)
        .input('id', sql.Int, requisitionId)
        .query(`SELECT LineId, ItemId, QtyReserved - QtyIssued AS Qty
                FROM dbo.RequisitionLine WHERE RequisitionId = @id AND QtyReserved - QtyIssued > 0 ORDER BY LineId`)
    ).recordset;
    if (!lines.length) throw new HttpError(409, 'Nothing is reserved and waiting to be released.');

    const slipNumber = await nextNumber(tx, 'IS');
    const slipId = (
      await new sql.Request(tx)
        .input('number', sql.NVarChar(20), slipNumber)
        .input('rid', sql.Int, requisitionId)
        .input('userId', sql.Int, user.id)
        .query(`INSERT INTO dbo.IssuanceSlip (SlipNumber, RequisitionId, PreparedBy)
                OUTPUT inserted.SlipId VALUES (@number, @rid, @userId)`)
    ).recordset[0].SlipId;
    for (const line of lines) {
      await new sql.Request(tx)
        .input('slipId', sql.Int, slipId)
        .input('lineId', sql.Int, line.LineId)
        .input('itemId', sql.Int, line.ItemId)
        .input('qty', sql.Decimal(12, 2), line.Qty)
        .query(`INSERT INTO dbo.IssuanceLine (SlipId, RequisitionLineId, ItemId, Quantity)
                VALUES (@slipId, @lineId, @itemId, @qty)`);
    }
    await addDocHistory(tx, 'IS', slipId, null, 'prepared', user.id, null);
    return { id: slipId, slipNumber };
  });
}

async function explainNoChange(tx, id, needStatus) {
  const result = await new sql.Request(tx).input('id', sql.Int, id)
    .query('SELECT Status FROM dbo.IssuanceSlip WHERE SlipId = @id');
  if (!result.recordset.length) return new HttpError(404, 'Slip not found.');
  return new HttpError(409, `This slip is ${result.recordset[0].Status}, but it must be ${needStatus} for this action.`);
}

// The custodian hands the items to the requestor. Stock is not deducted yet.
async function releaseSlip(user, id) {
  return withTransaction(async (tx) => {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('userId', sql.Int, user.id)
      .query(`UPDATE dbo.IssuanceSlip SET Status = 'released', ReleasedBy = @userId, ReleasedAt = SYSDATETIME()
              WHERE SlipId = @id AND Status = 'prepared'`);
    if (result.rowsAffected[0] === 0) throw await explainNoChange(tx, id, 'prepared');
    await addDocHistory(tx, 'IS', id, 'prepared', 'released', user.id, null);
    return { id, status: 'released' };
  });
}

// A slip made by mistake can be cancelled until the items are released.
async function cancelSlip(user, id) {
  return withTransaction(async (tx) => {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query(`UPDATE dbo.IssuanceSlip SET Status = 'cancelled' WHERE SlipId = @id AND Status = 'prepared'`);
    if (result.rowsAffected[0] === 0) throw await explainNoChange(tx, id, 'prepared');
    await addDocHistory(tx, 'IS', id, 'prepared', 'cancelled', user.id, null);
    return { id, status: 'cancelled' };
  });
}

// The requestor confirms receipt. This is the "signed acknowledgment": who, when, and optional remarks.
// In the same transaction: deduct stock, log it, count what was issued, and close the requisition when done.
async function acknowledgeSlip(user, id, remarksText) {
  const remarks = String(remarksText || '').trim();
  if (remarks.length > 200) throw new HttpError(400, 'Remarks can be up to 200 characters.');

  return withTransaction(async (tx) => {
    const head = (
      await new sql.Request(tx)
        .input('id', sql.Int, id)
        .query(`SELECT s.Status, s.RequisitionId, s.ReleasedBy, s.SlipNumber, r.RequestedBy, r.ProjectId
                FROM dbo.IssuanceSlip s WITH (UPDLOCK, ROWLOCK)
                JOIN dbo.Requisition r ON r.RequisitionId = s.RequisitionId
                WHERE s.SlipId = @id`)
    ).recordset[0];
    if (!head) throw new HttpError(404, 'Slip not found.');
    if (head.RequestedBy !== user.id) throw new HttpError(403, 'Only the requestor can confirm receipt.');
    if (head.Status !== 'released') throw new HttpError(409, 'This slip is not waiting for confirmation.');

    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('userId', sql.Int, user.id)
      .input('remarks', sql.NVarChar(200), remarks || null)
      .query(`UPDATE dbo.IssuanceSlip
              SET Status = 'acknowledged', AcknowledgedBy = @userId, AcknowledgedAt = SYSDATETIME(), Remarks = @remarks
              WHERE SlipId = @id`);

    const lines = (
      await new sql.Request(tx)
        .input('id', sql.Int, id)
        .query('SELECT RequisitionLineId, ItemId, Quantity FROM dbo.IssuanceLine WHERE SlipId = @id ORDER BY ItemId')
    ).recordset;
    const mismatch = new HttpError(409, 'The stock record does not match this slip. Ask the warehouse to check it.');

    for (const line of lines) {
      // The reservation is used up and the stock leaves together, so Available stays correct.
      const moved = await new sql.Request(tx)
        .input('itemId', sql.Int, line.ItemId)
        .input('qty', sql.Decimal(12, 2), line.Quantity)
        .query(`UPDATE dbo.Item SET OnHand = OnHand - @qty, Reserved = Reserved - @qty
                WHERE ItemId = @itemId AND Reserved >= @qty AND OnHand >= @qty`);
      if (moved.rowsAffected[0] === 0) throw mismatch;

      const counted = await new sql.Request(tx)
        .input('lineId', sql.Int, line.RequisitionLineId)
        .input('qty', sql.Decimal(12, 2), line.Quantity)
        .query(`UPDATE dbo.RequisitionLine SET QtyIssued = QtyIssued + @qty
                WHERE LineId = @lineId AND QtyIssued + @qty <= QtyReserved`);
      if (counted.rowsAffected[0] === 0) throw mismatch;

      await new sql.Request(tx)
        .input('itemId', sql.Int, line.ItemId)
        .input('qty', sql.Decimal(12, 2), -line.Quantity)
        .input('slipId', sql.Int, id)
        .input('projectId', sql.Int, head.ProjectId)
        .input('userId', sql.Int, head.ReleasedBy)
        .input('note', sql.NVarChar(200), head.SlipNumber)
        .query(`INSERT INTO dbo.StockTransaction (ItemId, TxType, Quantity, RefDocType, RefDocId, ProjectId, CreatedBy, Note)
                VALUES (@itemId, 'issue', @qty, 'IS', @slipId, @projectId, @userId, @note)`);
    }

    // Close the requisition when every line is fully issued, otherwise mark it partly fulfilled.
    const remaining = (
      await new sql.Request(tx)
        .input('rid', sql.Int, head.RequisitionId)
        .query('SELECT COUNT(*) AS Remaining FROM dbo.RequisitionLine WHERE RequisitionId = @rid AND QtyIssued < Quantity')
    ).recordset[0].Remaining;
    const nextStatus = remaining > 0 ? 'partly_fulfilled' : 'fulfilled';
    const rf = (
      await new sql.Request(tx)
        .input('rid', sql.Int, head.RequisitionId)
        .query('SELECT Status FROM dbo.Requisition WITH (UPDLOCK, ROWLOCK) WHERE RequisitionId = @rid')
    ).recordset[0];
    if (rf.Status !== nextStatus) {
      await new sql.Request(tx)
        .input('rid', sql.Int, head.RequisitionId)
        .input('status', sql.NVarChar(20), nextStatus)
        .query('UPDATE dbo.Requisition SET Status = @status, UpdatedAt = SYSDATETIME() WHERE RequisitionId = @rid');
      await addDocHistory(tx, 'RF', head.RequisitionId, rf.Status, nextStatus, user.id, `Items issued on ${head.SlipNumber}`);
    }
    await addDocHistory(tx, 'IS', id, 'released', 'acknowledged', user.id, remarks || null);
    return { id, status: 'acknowledged', requisitionStatus: nextStatus };
  });
}

module.exports = { listReleasable, listSlips, getSlip, prepareSlip, releaseSlip, cancelSlip, acknowledgeSlip };
