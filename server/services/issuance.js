// Release side of Inventory, following the flowchart:
//   Stock issuance slip (prepared for release) -> Deliver / issue items to requestor
//   -> Signed acknowledgment (verified by requestor) -> Deduct issued quantities and close requisition.
// Stock is deducted only when the requestor confirms receipt.
const db = require('../db');
const { nextNumber } = require('./numbering');
const { addDocHistory } = require('./history');
const { notifyUser } = require('./notifications');
const { HttpError } = require('./errors');

const SLIP_STATUSES = ['prepared', 'released', 'acknowledged', 'cancelled'];
const NOW = `datetime('now','localtime')`;

const SLIP_HEADER_SQL = `
  SELECT s.SlipId, s.SlipNumber, s.Status, s.RequisitionId, r.RfNumber, r.RequestedBy, r.Purpose,
         p.Code AS ProjectCode, p.Name AS ProjectName, u.FullName AS RequestedByName,
         pb.FullName AS PreparedByName, substr(s.PreparedAt, 1, 16) AS PreparedAt,
         rb.FullName AS ReleasedByName, substr(s.ReleasedAt, 1, 16) AS ReleasedAt,
         ab.FullName AS AcknowledgedByName, substr(s.AcknowledgedAt, 1, 16) AS AcknowledgedAt,
         s.Remarks
  FROM IssuanceSlip s
  JOIN Requisition r ON r.RequisitionId = s.RequisitionId
  JOIN Project p ON p.ProjectId = r.ProjectId
  JOIN AppUser u ON u.UserId = r.RequestedBy
  JOIN AppUser pb ON pb.UserId = s.PreparedBy
  LEFT JOIN AppUser rb ON rb.UserId = s.ReleasedBy
  LEFT JOIN AppUser ab ON ab.UserId = s.AcknowledgedBy`;

function assertCanView(user, slip) {
  if (user.role === 'owner' || user.role === 'custodian') return;
  if (user.role === 'foreman' && slip.RequestedBy === user.id) return;
  throw new HttpError(403, 'You cannot open this slip.');
}

// Approved requisitions that have reserved items waiting and no open slip yet.
function listReleasable() {
  return db.all(`
    SELECT r.RequisitionId, r.RfNumber, p.Code AS ProjectCode, u.FullName AS RequestedByName,
           r.DateNeeded, r.Urgency, COUNT(*) AS LinesToRelease
    FROM Requisition r
    JOIN Project p ON p.ProjectId = r.ProjectId
    JOIN AppUser u ON u.UserId = r.RequestedBy
    JOIN RequisitionLine l ON l.RequisitionId = r.RequisitionId AND l.QtyReserved - l.QtyIssued > 0
    WHERE r.Status IN ('approved', 'partly_fulfilled')
      AND NOT EXISTS (SELECT 1 FROM IssuanceSlip s
                      WHERE s.RequisitionId = r.RequisitionId AND s.Status IN ('prepared', 'released'))
    GROUP BY r.RequisitionId, r.RfNumber, p.Code, u.FullName, r.DateNeeded, r.Urgency
    ORDER BY r.RequisitionId`);
}

function listSlips(user, status) {
  if (status && !SLIP_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  const where = [];
  const params = {};
  if (status) { where.push('s.Status = @status'); params.status = status; }
  if (user.role === 'foreman') { where.push('r.RequestedBy = @userId'); params.userId = user.id; }
  return db.all(
    `SELECT s.SlipId, s.SlipNumber, s.Status, r.RequisitionId, r.RfNumber, p.Code AS ProjectCode,
            u.FullName AS RequestedByName, substr(s.PreparedAt, 1, 16) AS PreparedAt,
            (SELECT COUNT(*) FROM IssuanceLine x WHERE x.SlipId = s.SlipId) AS LineCount
     FROM IssuanceSlip s
     JOIN Requisition r ON r.RequisitionId = s.RequisitionId
     JOIN Project p ON p.ProjectId = r.ProjectId
     JOIN AppUser u ON u.UserId = r.RequestedBy
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.SlipId DESC`,
    params
  );
}

function getSlip(user, id) {
  const row = db.get(`${SLIP_HEADER_SQL} WHERE s.SlipId = @id`, { id });
  if (!row) throw new HttpError(404, 'Slip not found.');
  assertCanView(user, row);
  const slip = { ...row };
  slip.lines = db.all(
    `SELECT l.SlipLineId, i.Code, i.Description, i.Unit, l.Quantity
     FROM IssuanceLine l JOIN Item i ON i.ItemId = l.ItemId
     WHERE l.SlipId = @id ORDER BY l.SlipLineId`,
    { id }
  );
  slip.history = db.all(
    `SELECT h.FromStatus, h.ToStatus, u.FullName AS ChangedByName, substr(h.ChangedAt, 1, 16) AS ChangedAt, h.Reason
     FROM StatusHistory h JOIN AppUser u ON u.UserId = h.ChangedBy
     WHERE h.DocType = 'IS' AND h.DocId = @id ORDER BY h.HistoryId`,
    { id }
  );
  return slip;
}

// The warehouse prepares a slip for everything reserved and not yet issued on one requisition.
function prepareSlip(user, requisitionId) {
  return db.transaction(() => {
    const rf = db.get('SELECT Status FROM Requisition WHERE RequisitionId = @id', { id: requisitionId });
    if (!rf) throw new HttpError(404, 'Requisition not found.');
    if (!['approved', 'partly_fulfilled'].includes(rf.Status)) {
      throw new HttpError(409, 'Only an approved requisition can get an issuance slip.');
    }
    const open = db.get(
      `SELECT SlipNumber FROM IssuanceSlip WHERE RequisitionId = @id AND Status IN ('prepared', 'released')`,
      { id: requisitionId }
    );
    if (open) throw new HttpError(409, `${open.SlipNumber} is still open for this requisition.`);

    const lines = db.all(
      `SELECT LineId, ItemId, ROUND(QtyReserved - QtyIssued, 2) AS Qty
       FROM RequisitionLine WHERE RequisitionId = @id AND QtyReserved - QtyIssued > 0 ORDER BY LineId`,
      { id: requisitionId }
    );
    if (!lines.length) throw new HttpError(409, 'Nothing is reserved and waiting to be released.');

    const slipNumber = nextNumber('IS');
    const { lastId: slipId } = db.run(
      'INSERT INTO IssuanceSlip (SlipNumber, RequisitionId, PreparedBy) VALUES (@slipNumber, @requisitionId, @userId)',
      { slipNumber, requisitionId, userId: user.id }
    );
    for (const line of lines) {
      db.run(
        `INSERT INTO IssuanceLine (SlipId, RequisitionLineId, ItemId, Quantity)
         VALUES (@slipId, @lineId, @itemId, @qty)`,
        { slipId, lineId: line.LineId, itemId: line.ItemId, qty: line.Qty }
      );
    }
    addDocHistory('IS', slipId, null, 'prepared', user.id, null);
    return { id: slipId, slipNumber };
  });
}

function explainNoChange(id, needStatus) {
  const row = db.get('SELECT Status FROM IssuanceSlip WHERE SlipId = @id', { id });
  if (!row) return new HttpError(404, 'Slip not found.');
  return new HttpError(409, `This slip is ${row.Status}, but it must be ${needStatus} for this action.`);
}

// The custodian hands the items to the requestor. Stock is not deducted yet.
function releaseSlip(user, id) {
  return db.transaction(() => {
    const { changes } = db.run(
      `UPDATE IssuanceSlip SET Status = 'released', ReleasedBy = @userId, ReleasedAt = ${NOW}
       WHERE SlipId = @id AND Status = 'prepared'`,
      { id, userId: user.id }
    );
    if (changes === 0) throw explainNoChange(id, 'prepared');
    addDocHistory('IS', id, 'prepared', 'released', user.id, null);
    const slip = db.get(
      `SELECT s.SlipNumber, r.RequestedBy FROM IssuanceSlip s
       JOIN Requisition r ON r.RequisitionId = s.RequisitionId WHERE s.SlipId = @id`,
      { id }
    );
    notifyUser(slip.RequestedBy, `${slip.SlipNumber} was released. Check the items and confirm receipt.`, `/slip.html?id=${id}`);
    return { id, status: 'released' };
  });
}

// A slip made by mistake can be cancelled until the items are released.
function cancelSlip(user, id) {
  return db.transaction(() => {
    const { changes } = db.run(`UPDATE IssuanceSlip SET Status = 'cancelled' WHERE SlipId = @id AND Status = 'prepared'`, { id });
    if (changes === 0) throw explainNoChange(id, 'prepared');
    addDocHistory('IS', id, 'prepared', 'cancelled', user.id, null);
    return { id, status: 'cancelled' };
  });
}

// The requestor confirms receipt. This is the "signed acknowledgment": who, when, and optional remarks.
// In the same transaction: deduct stock, log it, count what was issued, and close the requisition when done.
function acknowledgeSlip(user, id, remarksText) {
  const remarks = String(remarksText || '').trim();
  if (remarks.length > 200) throw new HttpError(400, 'Remarks can be up to 200 characters.');

  return db.transaction(() => {
    const head = db.get(
      `SELECT s.Status, s.RequisitionId, s.ReleasedBy, s.SlipNumber, r.RequestedBy, r.ProjectId
       FROM IssuanceSlip s JOIN Requisition r ON r.RequisitionId = s.RequisitionId
       WHERE s.SlipId = @id`,
      { id }
    );
    if (!head) throw new HttpError(404, 'Slip not found.');
    if (head.RequestedBy !== user.id) throw new HttpError(403, 'Only the requestor can confirm receipt.');
    if (head.Status !== 'released') throw new HttpError(409, 'This slip is not waiting for confirmation.');

    db.run(
      `UPDATE IssuanceSlip SET Status = 'acknowledged', AcknowledgedBy = @userId, AcknowledgedAt = ${NOW}, Remarks = @remarks
       WHERE SlipId = @id`,
      { id, userId: user.id, remarks: remarks || null }
    );

    const lines = db.all(
      'SELECT RequisitionLineId, ItemId, Quantity FROM IssuanceLine WHERE SlipId = @id ORDER BY ItemId',
      { id }
    );
    const mismatch = () => new HttpError(409, 'The stock record does not match this slip. Ask the warehouse to check it.');

    for (const line of lines) {
      // The reservation is used up and the stock leaves together, so Available stays correct.
      const moved = db.run(
        `UPDATE Item SET OnHand = ROUND(OnHand - @qty, 2), Reserved = ROUND(Reserved - @qty, 2)
         WHERE ItemId = @itemId AND Reserved + 0.001 >= @qty AND OnHand + 0.001 >= @qty`,
        { itemId: line.ItemId, qty: line.Quantity }
      );
      if (moved.changes === 0) throw mismatch();

      const counted = db.run(
        `UPDATE RequisitionLine SET QtyIssued = ROUND(QtyIssued + @qty, 2)
         WHERE LineId = @lineId AND QtyIssued + @qty <= QtyReserved + 0.001`,
        { lineId: line.RequisitionLineId, qty: line.Quantity }
      );
      if (counted.changes === 0) throw mismatch();

      db.run(
        `INSERT INTO StockTransaction (ItemId, TxType, Quantity, RefDocType, RefDocId, ProjectId, CreatedBy, Note)
         VALUES (@itemId, 'issue', @qty, 'IS', @slipId, @projectId, @userId, @note)`,
        { itemId: line.ItemId, qty: -line.Quantity, slipId: id, projectId: head.ProjectId, userId: head.ReleasedBy, note: head.SlipNumber }
      );
    }

    // Close the requisition when every line is fully issued, otherwise mark it partly fulfilled.
    const remaining = db.get(
      'SELECT COUNT(*) AS n FROM RequisitionLine WHERE RequisitionId = @rid AND QtyIssued + 0.001 < Quantity',
      { rid: head.RequisitionId }
    ).n;
    const nextStatus = remaining > 0 ? 'partly_fulfilled' : 'fulfilled';
    const rf = db.get('SELECT Status FROM Requisition WHERE RequisitionId = @rid', { rid: head.RequisitionId });
    if (rf.Status !== nextStatus) {
      db.run(`UPDATE Requisition SET Status = @status, UpdatedAt = ${NOW} WHERE RequisitionId = @rid`,
        { status: nextStatus, rid: head.RequisitionId });
      addDocHistory('RF', head.RequisitionId, rf.Status, nextStatus, user.id, `Items issued on ${head.SlipNumber}`);
    }
    addDocHistory('IS', id, 'released', 'acknowledged', user.id, remarks || null);
    return { id, status: 'acknowledged', requisitionStatus: nextStatus };
  });
}

module.exports = { listReleasable, listSlips, getSlip, prepareSlip, releaseSlip, cancelSlip, acknowledgeSlip };
