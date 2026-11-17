// Requisition module (owner: Leo): file, revise, approve, return and cancel a Requisition Form.
// Every change of status writes a StatusHistory row in the same transaction.
const { sql, query, withTransaction } = require('../db');
const { nextNumber } = require('./numbering');
const { HttpError } = require('./errors');
const { STATUSES, validateRfInput, canRevise } = require('./rfRules');
const { reserveForRequisition } = require('./reservation');
const { createPurchaseRequisition } = require('./handoff');

const HEADER_SQL = `
  SELECT r.RequisitionId, r.RfNumber, r.ProjectId, p.Code AS ProjectCode, p.Name AS ProjectName,
         r.RequestedBy, u.FullName AS RequestedByName,
         CONVERT(varchar(10), r.DateNeeded, 23) AS DateNeeded, r.Urgency, r.Purpose, r.Status,
         r.ReturnReason, r.RevisionCount, d.FullName AS DecidedByName,
         CONVERT(varchar(16), r.DecidedAt, 120) AS DecidedAt,
         CONVERT(varchar(16), r.CreatedAt, 120) AS CreatedAt
  FROM dbo.Requisition r
  JOIN dbo.Project p ON p.ProjectId = r.ProjectId
  JOIN dbo.AppUser u ON u.UserId = r.RequestedBy
  LEFT JOIN dbo.AppUser d ON d.UserId = r.DecidedBy`;

function assertCanView(user, rf) {
  if (user.role === 'owner') return;
  if (user.role === 'foreman' && rf.RequestedBy === user.id) return;
  throw new HttpError(403, 'You cannot open this requisition.');
}

async function listRequisitions(user, status) {
  if (user.role !== 'owner' && user.role !== 'foreman') {
    throw new HttpError(403, 'Your role cannot see requisitions yet.');
  }
  if (status && !STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  const where = [];
  const params = {};
  if (status) { where.push('r.Status = @status'); params.status = status; }
  if (user.role === 'foreman') { where.push('r.RequestedBy = @userId'); params.userId = user.id; }
  return query(
    `${HEADER_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.RequisitionId DESC`,
    params
  );
}

async function getRequisition(user, id) {
  const rows = await query(`${HEADER_SQL} WHERE r.RequisitionId = @id`, { id });
  if (!rows.length) throw new HttpError(404, 'Requisition not found.');
  const rf = rows[0];
  assertCanView(user, rf);
  rf.lines = await query(
    `SELECT l.LineId, l.ItemId, i.Code, i.Description, i.Unit, l.Quantity, l.QtyReserved, l.QtyShort, l.QtyIssued
     FROM dbo.RequisitionLine l JOIN dbo.Item i ON i.ItemId = l.ItemId
     WHERE l.RequisitionId = @id ORDER BY l.LineId`,
    { id }
  );
  rf.history = await query(
    `SELECT h.FromStatus, h.ToStatus, u.FullName AS ChangedByName,
            CONVERT(varchar(16), h.ChangedAt, 120) AS ChangedAt, h.Reason
     FROM dbo.StatusHistory h JOIN dbo.AppUser u ON u.UserId = h.ChangedBy
     WHERE h.DocType = 'RF' AND h.DocId = @id ORDER BY h.HistoryId`,
    { id }
  );
  rf.canRevise = rf.RequestedBy === user.id && canRevise(rf);
  return rf;
}

async function addHistory(tx, id, from, to, userId, reason) {
  await new sql.Request(tx)
    .input('id', sql.Int, id)
    .input('from', sql.NVarChar(30), from)
    .input('to', sql.NVarChar(30), to)
    .input('userId', sql.Int, userId)
    .input('reason', sql.NVarChar(300), reason)
    .query(`INSERT INTO dbo.StatusHistory (DocType, DocId, FromStatus, ToStatus, ChangedBy, Reason)
            VALUES ('RF', @id, @from, @to, @userId, @reason)`);
}

// The project must be active and every item must still be active.
async function checkProjectAndItems(tx, input) {
  const project = await new sql.Request(tx)
    .input('id', sql.Int, input.projectId)
    .query(`SELECT 1 AS ok FROM dbo.Project WHERE ProjectId = @id AND Status = 'active'`);
  if (!project.recordset.length) throw new HttpError(400, 'That project is not available.');
  for (const line of input.lines) {
    const item = await new sql.Request(tx)
      .input('id', sql.Int, line.itemId)
      .query('SELECT 1 AS ok FROM dbo.Item WHERE ItemId = @id AND IsActive = 1');
    if (!item.recordset.length) throw new HttpError(400, 'One of the items is no longer available.');
  }
}

async function insertLines(tx, requisitionId, lines) {
  for (const line of lines) {
    await new sql.Request(tx)
      .input('rid', sql.Int, requisitionId)
      .input('itemId', sql.Int, line.itemId)
      .input('qty', sql.Decimal(12, 2), line.quantity)
      .query('INSERT INTO dbo.RequisitionLine (RequisitionId, ItemId, Quantity) VALUES (@rid, @itemId, @qty)');
  }
}

async function createRequisition(user, body) {
  const input = validateRfInput(body);
  return withTransaction(async (tx) => {
    await checkProjectAndItems(tx, input);
    const rfNumber = await nextNumber(tx, 'RF');
    const result = await new sql.Request(tx)
      .input('rfNumber', sql.NVarChar(20), rfNumber)
      .input('projectId', sql.Int, input.projectId)
      .input('userId', sql.Int, user.id)
      .input('dateNeeded', sql.VarChar(10), input.dateNeeded)
      .input('urgency', sql.NVarChar(10), input.urgency)
      .input('purpose', sql.NVarChar(300), input.purpose)
      .query(`INSERT INTO dbo.Requisition (RfNumber, ProjectId, RequestedBy, DateNeeded, Urgency, Purpose)
              OUTPUT inserted.RequisitionId
              VALUES (@rfNumber, @projectId, @userId, CONVERT(date, @dateNeeded, 23), @urgency, @purpose)`);
    const id = result.recordset[0].RequisitionId;
    await insertLines(tx, id, input.lines);
    await addHistory(tx, id, null, 'pending', user.id, null);
    return { id, rfNumber };
  });
}

// Says why an update changed nothing: missing, not yours, or in the wrong status.
async function explainNoChange(tx, id, user, needStatus, mustBeOwner) {
  const result = await new sql.Request(tx)
    .input('id', sql.Int, id)
    .query('SELECT Status, RequestedBy FROM dbo.Requisition WHERE RequisitionId = @id');
  if (!result.recordset.length) return new HttpError(404, 'Requisition not found.');
  const row = result.recordset[0];
  if (mustBeOwner && row.RequestedBy !== user.id) return new HttpError(403, 'This is not your requisition.');
  return new HttpError(409, `This requisition is ${row.Status.replace('_', ' ')}, but it must be ${needStatus} for this action.`);
}

async function approveRequisition(user, id) {
  return withTransaction(async (tx) => {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('userId', sql.Int, user.id)
      .query(`UPDATE dbo.Requisition
              SET Status = 'approved', DecidedBy = @userId, DecidedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
              WHERE RequisitionId = @id AND Status = 'pending'`);
    if (result.rowsAffected[0] === 0) throw await explainNoChange(tx, id, user, 'pending', false);
    await addHistory(tx, id, 'pending', 'approved', user.id, null);

    // Inventory check and reservation, in this same transaction.
    const shortages = await reserveForRequisition(tx, id);
    let purchaseRequisition = null;
    if (shortages.length) {
      const header = (
        await new sql.Request(tx)
          .input('id', sql.Int, id)
          .query('SELECT RfNumber, ProjectId FROM dbo.Requisition WHERE RequisitionId = @id')
      ).recordset[0];
      purchaseRequisition = await createPurchaseRequisition(tx, {
        requisitionId: id, rfNumber: header.RfNumber, projectId: header.ProjectId, lines: shortages,
      });
    }
    return { id, status: 'approved', shortLines: shortages.length, purchaseRequisition };
  });
}

async function returnRequisition(user, id, reasonText) {
  const reason = String(reasonText || '').trim();
  if (!reason || reason.length > 300) throw new HttpError(400, 'Write the reason for returning it, up to 300 characters.');
  return withTransaction(async (tx) => {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('userId', sql.Int, user.id)
      .input('reason', sql.NVarChar(300), reason)
      .query(`UPDATE dbo.Requisition
              SET Status = 'returned', ReturnReason = @reason, DecidedBy = @userId,
                  DecidedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
              WHERE RequisitionId = @id AND Status = 'pending'`);
    if (result.rowsAffected[0] === 0) throw await explainNoChange(tx, id, user, 'pending', false);
    await addHistory(tx, id, 'pending', 'returned', user.id, reason);
    return { id, status: 'returned' };
  });
}

// The requestor chooses not to revise a returned RF. It stays on file as cancelled.
async function cancelRequisition(user, id, reasonText) {
  const reason = String(reasonText || '').trim().slice(0, 300) || 'Not revised';
  return withTransaction(async (tx) => {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('userId', sql.Int, user.id)
      .query(`UPDATE dbo.Requisition SET Status = 'cancelled', UpdatedAt = SYSDATETIME()
              WHERE RequisitionId = @id AND RequestedBy = @userId AND Status = 'returned'`);
    if (result.rowsAffected[0] === 0) throw await explainNoChange(tx, id, user, 'returned', true);
    await addHistory(tx, id, 'returned', 'cancelled', user.id, reason);
    return { id, status: 'cancelled' };
  });
}

async function reviseRequisition(user, id, body) {
  const input = validateRfInput(body);
  return withTransaction(async (tx) => {
    const current = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query(`SELECT Status, RevisionCount, RequestedBy
              FROM dbo.Requisition WITH (UPDLOCK, ROWLOCK) WHERE RequisitionId = @id`);
    if (!current.recordset.length) throw new HttpError(404, 'Requisition not found.');
    const rf = current.recordset[0];
    if (rf.RequestedBy !== user.id) throw new HttpError(403, 'This is not your requisition.');
    if (rf.Status !== 'returned') throw new HttpError(409, 'Only a returned requisition can be revised.');
    if (!canRevise(rf)) {
      throw new HttpError(409, 'This requisition was already revised once. Cancel it and file a new one.');
    }
    await checkProjectAndItems(tx, input);
    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('projectId', sql.Int, input.projectId)
      .input('dateNeeded', sql.VarChar(10), input.dateNeeded)
      .input('urgency', sql.NVarChar(10), input.urgency)
      .input('purpose', sql.NVarChar(300), input.purpose)
      .query(`UPDATE dbo.Requisition
              SET ProjectId = @projectId, DateNeeded = CONVERT(date, @dateNeeded, 23), Urgency = @urgency,
                  Purpose = @purpose, Status = 'pending', RevisionCount = RevisionCount + 1,
                  DecidedBy = NULL, DecidedAt = NULL, UpdatedAt = SYSDATETIME()
              WHERE RequisitionId = @id`);
    await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM dbo.RequisitionLine WHERE RequisitionId = @id');
    await insertLines(tx, id, input.lines);
    await addHistory(tx, id, 'returned', 'pending', user.id, 'Revised and resubmitted');
    return { id, status: 'pending' };
  });
}

module.exports = {
  listRequisitions, getRequisition, createRequisition, reviseRequisition,
  approveRequisition, returnRequisition, cancelRequisition,
};
