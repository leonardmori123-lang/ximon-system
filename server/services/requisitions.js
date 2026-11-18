// Requisition module (owner: Leo): file, revise, approve, return and cancel a Requisition Form.
// Every change of status writes a StatusHistory row in the same transaction.
const db = require('../db');
const { nextNumber } = require('./numbering');
const { HttpError } = require('./errors');
const { STATUSES, validateRfInput, canRevise } = require('./rfRules');
const { reserveForRequisition } = require('./reservation');
const { createPurchaseRequisition } = require('./handoff');
const { addDocHistory, getDocHistory } = require('./history');
const { notifyUser, notifyRole } = require('./notifications');

const HEADER_SQL = `
  SELECT r.RequisitionId, r.RfNumber, r.ProjectId, p.Code AS ProjectCode, p.Name AS ProjectName,
         r.RequestedBy, u.FullName AS RequestedByName,
         r.DateNeeded, r.Urgency, r.Purpose, r.Status,
         r.ReturnReason, r.RevisionCount, d.FullName AS DecidedByName,
         substr(r.DecidedAt, 1, 16) AS DecidedAt,
         substr(r.CreatedAt, 1, 16) AS CreatedAt
  FROM Requisition r
  JOIN Project p ON p.ProjectId = r.ProjectId
  JOIN AppUser u ON u.UserId = r.RequestedBy
  LEFT JOIN AppUser d ON d.UserId = r.DecidedBy`;

const addHistory = (id, from, to, userId, reason) => addDocHistory('RF', id, from, to, userId, reason);
const rfLink = (id) => `/requisition.html?id=${id}`;
const nameOf = (userId) => db.get('SELECT FullName FROM AppUser WHERE UserId = @userId', { userId }).FullName;

function assertCanView(user, rf) {
  if (user.role === 'owner') return;
  if (user.role === 'foreman' && rf.RequestedBy === user.id) return;
  throw new HttpError(403, 'You cannot open this requisition.');
}

function listRequisitions(user, status) {
  if (user.role !== 'owner' && user.role !== 'foreman') {
    throw new HttpError(403, 'Your role cannot see requisitions yet.');
  }
  if (status && !STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  const where = [];
  const params = {};
  if (status) { where.push('r.Status = @status'); params.status = status; }
  if (user.role === 'foreman') { where.push('r.RequestedBy = @userId'); params.userId = user.id; }
  return db.all(`${HEADER_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.RequisitionId DESC`, params);
}

function getRequisition(user, id) {
  const rf = db.get(`${HEADER_SQL} WHERE r.RequisitionId = @id`, { id });
  if (!rf) throw new HttpError(404, 'Requisition not found.');
  assertCanView(user, rf);
  const result = { ...rf };
  result.lines = db.all(
    `SELECT l.LineId, l.ItemId, i.Code, i.Description, i.Unit, l.Quantity, l.QtyReserved, l.QtyShort, l.QtyIssued
     FROM RequisitionLine l JOIN Item i ON i.ItemId = l.ItemId
     WHERE l.RequisitionId = @id ORDER BY l.LineId`,
    { id }
  );
  result.history = getDocHistory('RF', id);
  result.slips = db.all(
    `SELECT SlipId, SlipNumber, Status, substr(PreparedAt, 1, 16) AS PreparedAt
     FROM IssuanceSlip WHERE RequisitionId = @id ORDER BY SlipId`,
    { id }
  );
  result.canRevise = rf.RequestedBy === user.id && canRevise(rf);
  return result;
}

// The project must be active and every item must still be active.
function checkProjectAndItems(input) {
  if (!db.get(`SELECT 1 AS ok FROM Project WHERE ProjectId = @id AND Status = 'active'`, { id: input.projectId })) {
    throw new HttpError(400, 'That project is not available.');
  }
  for (const line of input.lines) {
    if (!db.get('SELECT 1 AS ok FROM Item WHERE ItemId = @id AND IsActive = 1', { id: line.itemId })) {
      throw new HttpError(400, 'One of the items is no longer available.');
    }
  }
}

function insertLines(requisitionId, lines) {
  for (const line of lines) {
    db.run('INSERT INTO RequisitionLine (RequisitionId, ItemId, Quantity) VALUES (@requisitionId, @itemId, @quantity)',
      { requisitionId, itemId: line.itemId, quantity: line.quantity });
  }
}

function createRequisition(user, body) {
  const input = validateRfInput(body);
  return db.transaction(() => {
    checkProjectAndItems(input);
    const rfNumber = nextNumber('RF');
    const { lastId: id } = db.run(
      `INSERT INTO Requisition (RfNumber, ProjectId, RequestedBy, DateNeeded, Urgency, Purpose)
       VALUES (@rfNumber, @projectId, @userId, @dateNeeded, @urgency, @purpose)`,
      { rfNumber, projectId: input.projectId, userId: user.id, dateNeeded: input.dateNeeded, urgency: input.urgency, purpose: input.purpose }
    );
    insertLines(id, input.lines);
    addHistory(id, null, 'pending', user.id, null);
    // Flowchart: "Owner gets notification"
    notifyRole('owner', `${rfNumber} was filed by ${nameOf(user.id)} and needs your approval.`, rfLink(id));
    return { id, rfNumber };
  });
}

// Says why an update changed nothing: missing, not yours, or in the wrong status.
function explainNoChange(id, user, needStatus, mustBeOwner) {
  const row = db.get('SELECT Status, RequestedBy FROM Requisition WHERE RequisitionId = @id', { id });
  if (!row) return new HttpError(404, 'Requisition not found.');
  if (mustBeOwner && row.RequestedBy !== user.id) return new HttpError(403, 'This is not your requisition.');
  return new HttpError(409, `This requisition is ${row.Status.replace('_', ' ')}, but it must be ${needStatus} for this action.`);
}

function approveRequisition(user, id) {
  return db.transaction(() => {
    const { changes } = db.run(
      `UPDATE Requisition
       SET Status = 'approved', DecidedBy = @userId, DecidedAt = datetime('now','localtime'), UpdatedAt = datetime('now','localtime')
       WHERE RequisitionId = @id AND Status = 'pending'`,
      { id, userId: user.id }
    );
    if (changes === 0) throw explainNoChange(id, user, 'pending', false);
    addHistory(id, 'pending', 'approved', user.id, null);

    // Inventory check and reservation, in this same transaction.
    const header = db.get('SELECT RfNumber, ProjectId, RequestedBy FROM Requisition WHERE RequisitionId = @id', { id });
    const shortages = reserveForRequisition(id);
    let purchaseRequisition = null;
    if (shortages.length) {
      purchaseRequisition = createPurchaseRequisition({
        requisitionId: id, rfNumber: header.RfNumber, projectId: header.ProjectId, lines: shortages, userId: user.id,
      });
    }

    // Tell the requestor, and the warehouse when something was reserved.
    let stockMessage = 'All items are reserved.';
    if (shortages.length > 0) {
      const itemWords = shortages.length === 1 ? '1 item is' : `${shortages.length} items are`;
      stockMessage = `${itemWords} short of stock.`;
    }
    notifyUser(header.RequestedBy, `${header.RfNumber} was approved. ${stockMessage}`, rfLink(id));
    if (db.get('SELECT 1 AS ok FROM RequisitionLine WHERE RequisitionId = @id AND QtyReserved > 0', { id })) {
      notifyRole('custodian', `${header.RfNumber} is approved and has reserved items ready for a slip.`, '/slips.html');
    }
    return { id, status: 'approved', shortLines: shortages.length, purchaseRequisition };
  });
}

function returnRequisition(user, id, reasonText) {
  const reason = String(reasonText || '').trim();
  if (!reason || reason.length > 300) throw new HttpError(400, 'Write the reason for returning it, up to 300 characters.');
  return db.transaction(() => {
    const { changes } = db.run(
      `UPDATE Requisition
       SET Status = 'returned', ReturnReason = @reason, DecidedBy = @userId,
           DecidedAt = datetime('now','localtime'), UpdatedAt = datetime('now','localtime')
       WHERE RequisitionId = @id AND Status = 'pending'`,
      { id, userId: user.id, reason }
    );
    if (changes === 0) throw explainNoChange(id, user, 'pending', false);
    addHistory(id, 'pending', 'returned', user.id, reason);
    const header = db.get('SELECT RfNumber, RequestedBy FROM Requisition WHERE RequisitionId = @id', { id });
    notifyUser(header.RequestedBy, `${header.RfNumber} was returned: ${reason}`, rfLink(id));
    return { id, status: 'returned' };
  });
}

// The requestor chooses not to revise a returned RF. It stays on file as cancelled.
function cancelRequisition(user, id, reasonText) {
  const reason = String(reasonText || '').trim().slice(0, 300) || 'Not revised';
  return db.transaction(() => {
    const { changes } = db.run(
      `UPDATE Requisition SET Status = 'cancelled', UpdatedAt = datetime('now','localtime')
       WHERE RequisitionId = @id AND RequestedBy = @userId AND Status = 'returned'`,
      { id, userId: user.id }
    );
    if (changes === 0) throw explainNoChange(id, user, 'returned', true);
    addHistory(id, 'returned', 'cancelled', user.id, reason);
    return { id, status: 'cancelled' };
  });
}

function reviseRequisition(user, id, body) {
  const input = validateRfInput(body);
  return db.transaction(() => {
    const rf = db.get('SELECT Status, RevisionCount, RequestedBy FROM Requisition WHERE RequisitionId = @id', { id });
    if (!rf) throw new HttpError(404, 'Requisition not found.');
    if (rf.RequestedBy !== user.id) throw new HttpError(403, 'This is not your requisition.');
    if (rf.Status !== 'returned') throw new HttpError(409, 'Only a returned requisition can be revised.');
    if (!canRevise(rf)) throw new HttpError(409, 'This requisition was already revised once. Cancel it and file a new one.');
    checkProjectAndItems(input);
    db.run(
      `UPDATE Requisition
       SET ProjectId = @projectId, DateNeeded = @dateNeeded, Urgency = @urgency, Purpose = @purpose,
           Status = 'pending', RevisionCount = RevisionCount + 1, DecidedBy = NULL, DecidedAt = NULL,
           UpdatedAt = datetime('now','localtime')
       WHERE RequisitionId = @id`,
      { id, projectId: input.projectId, dateNeeded: input.dateNeeded, urgency: input.urgency, purpose: input.purpose }
    );
    db.run('DELETE FROM RequisitionLine WHERE RequisitionId = @id', { id });
    insertLines(id, input.lines);
    addHistory(id, 'returned', 'pending', user.id, 'Revised and resubmitted');
    const rfNumber = db.get('SELECT RfNumber FROM Requisition WHERE RequisitionId = @id', { id }).RfNumber;
    notifyRole('owner', `${rfNumber} was revised by ${nameOf(user.id)} and needs your approval again.`, rfLink(id));
    return { id, status: 'pending' };
  });
}

module.exports = {
  listRequisitions, getRequisition, createRequisition, reviseRequisition,
  approveRequisition, returnRequisition, cancelRequisition,
};
