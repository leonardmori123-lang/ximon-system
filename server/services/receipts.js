// Inventory receipt handling and requisition allocation for delivered goods.
const db = require('../db');
const { HttpError } = require('./errors');
const { hasTwoDecimals, planAllocation } = require('./stockRules');
const { prepareSlip } = require('./issuance');
const { notifyUser, notifyRole } = require('./notifications');

function isId(n) {
  return Number.isInteger(n) && n > 0;
}

function isQuantity(n) {
  return n > 0 && n <= 1000000 && hasTwoDecimals(n);
}

function receiveStock(input) {
  const data = input || {};
  const itemId = data.itemId;
  const quantity = data.quantity;
  const sourceDocument = data.sourceDocument;
  const projectId = data.projectId;
  const userId = data.userId;
  const doc = sourceDocument || {};

  if (!isId(itemId)) {
    throw new HttpError(400, 'receiveStock needs the itemId.');
  }
  if (!isQuantity(quantity)) {
    throw new HttpError(400, 'The received quantity must be above zero, with at most 2 decimals.');
  }
  if (!isId(userId)) {
    throw new HttpError(400, 'receiveStock needs the userId of the person who received the goods.');
  }
  if (!doc.type || !isId(doc.id)) {
    throw new HttpError(400, 'receiveStock needs the receiving report: sourceDocument { type, id }.');
  }
  if (projectId != null && !isId(projectId)) {
    throw new HttpError(400, 'The projectId is not valid.');
  }

  return db.transaction(() => {
    const { changes } = db.run(
      'UPDATE Item SET OnHand = ROUND(OnHand + @quantity, 2) WHERE ItemId = @itemId',
      { itemId, quantity }
    );
    if (changes === 0) {
      throw new HttpError(404, 'Item not found.');
    }
    const { lastId } = db.run(
      `INSERT INTO StockTransaction (ItemId, TxType, Quantity, RefDocType, RefDocId, ProjectId, CreatedBy, Note)
       VALUES (@itemId, 'receipt', @quantity, @docType, @docId, @projectId, @userId, @note)`,
      { itemId, quantity, docType: String(doc.type), docId: doc.id, projectId: projectId ?? null, userId, note: doc.number || null }
    );
    const { OnHand } = db.get('SELECT OnHand FROM Item WHERE ItemId = @itemId', { itemId });
    return { transactionId: lastId, onHand: OnHand };
  });
}

function allocateToRequisition(input) {
  const data = input || {};
  const requisitionId = data.requisitionId;
  const lines = data.lines;
  const userId = data.userId;

  if (!isId(requisitionId)) {
    throw new HttpError(400, 'allocateToRequisition needs the requisitionId.');
  }
  if (!isId(userId)) {
    throw new HttpError(400, 'allocateToRequisition needs the userId of the person who received the goods.');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, 'List the received lines.');
  }
  for (const line of lines) {
    const lineItemId = line && line.itemId;
    const lineQty = line && line.quantity;
    if (!isId(lineItemId) || !isQuantity(lineQty)) {
      throw new HttpError(400, 'Each line needs an itemId and a quantity above zero, with at most 2 decimals.');
    }
  }

  return db.transaction(() => {
    const rf = db.get('SELECT RfNumber, Status, RequestedBy FROM Requisition WHERE RequisitionId = @requisitionId', { requisitionId });
    if (!rf) {
      throw new HttpError(404, 'Requisition not found.');
    }
    const nothing = { allocated: [], slip: null };
    if (!['approved', 'partly_fulfilled'].includes(rf.Status)) {
      return nothing;
    }

    const allocated = [];
    for (const line of lines) {
      const row = db.get(
        `SELECT l.LineId, l.QtyShort, ROUND(i.OnHand - i.Reserved, 2) AS Available
         FROM RequisitionLine l JOIN Item i ON i.ItemId = l.ItemId
         WHERE l.RequisitionId = @requisitionId AND l.ItemId = @itemId`,
        { requisitionId, itemId: line.itemId }
      );
      if (!row) {
        continue;
      }
      const give = planAllocation(line.quantity, row.QtyShort, row.Available);
      if (give <= 0) {
        continue;
      }
      db.run('UPDATE Item SET Reserved = ROUND(Reserved + @give, 2) WHERE ItemId = @itemId', { give, itemId: line.itemId });
      db.run(
        'UPDATE RequisitionLine SET QtyReserved = ROUND(QtyReserved + @give, 2), QtyShort = ROUND(QtyShort - @give, 2) WHERE LineId = @lineId',
        { give, lineId: row.LineId }
      );
      allocated.push({ itemId: line.itemId, quantity: give });
    }
    if (allocated.length === 0) {
      return nothing;
    }

    const open = db.get(
      `SELECT 1 AS ok FROM IssuanceSlip WHERE RequisitionId = @requisitionId AND Status IN ('prepared', 'released')`,
      { requisitionId }
    );
    let slip = null;
    if (!open) {
      slip = prepareSlip({ id: userId }, requisitionId);
    }

    notifyUser(rf.RequestedBy, `Delivered items for ${rf.RfNumber} are set aside for you.`, `/requisition.html?id=${requisitionId}`);
    if (slip) {
      notifyRole('custodian', `${slip.slipNumber} for ${rf.RfNumber} is ready to release.`, `/slip.html?id=${slip.id}`);
    } else {
      notifyRole('custodian', `${rf.RfNumber} has more reserved items waiting. Prepare a slip once the open one is done.`, '/slips.html');
    }
    return { allocated, slip };
  });
}

module.exports = { receiveStock, allocateToRequisition };
