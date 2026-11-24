// Purchase order receiving handoff for warehouse deliveries.
const db = require('../db');
const { HttpError } = require('./errors');
const { hasTwoDecimals } = require('./stockRules');
const { addDocHistory } = require('./history');

function isId(n) {
  return Number.isInteger(n) && n > 0;
}

function isQuantity(n) {
  return typeof n === 'number' && n > 0 && n <= 1000000 && hasTwoDecimals(n);
}

// Updates received quantities and advances PO status inside caller's transaction.
function recordPoReceipt(input) {
  const data = input || {};
  const poId = data.poId;
  const lines = data.lines;
  const userId = data.userId;
  const reportNumber = data.reportNumber;

  if (!isId(poId)) {
    throw new HttpError(400, 'recordPoReceipt needs the poId.');
  }
  if (!isId(userId)) {
    throw new HttpError(400, 'recordPoReceipt needs the userId of the person who received the goods.');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, 'List the received lines.');
  }
  for (const line of lines) {
    if (!isId(line && line.poLineId) || !isQuantity(line.quantity)) {
      throw new HttpError(400, 'Each line needs a poLineId and a quantity above zero, with at most 2 decimals.');
    }
  }
  if (new Set(lines.map((l) => l.poLineId)).size !== lines.length) {
    throw new HttpError(400, 'List each purchase order line only once.');
  }

  return db.transaction(() => {
    const po = db.get(
      `SELECT po.PurchaseOrderId, po.PoNumber, po.Status, po.ProjectId, pr.RequisitionId
       FROM PurchaseOrder po
       LEFT JOIN PurchaseRequisition pr ON pr.PurchaseRequisitionId = po.PurchaseRequisitionId
       WHERE po.PurchaseOrderId = @poId`,
      { poId }
    );
    if (!po) {
      throw new HttpError(404, 'Purchase order not found.');
    }
    if (po.Status === 'closed') {
      throw new HttpError(409, `${po.PoNumber} is already closed, so nothing more can be received on it.`);
    }

    const received = [];
    for (const line of lines) {
      const row = db.get(
        `SELECT l.ItemId, i.Code, ROUND(l.Quantity - l.QtyReceived, 2) AS Outstanding
         FROM POLine l JOIN Item i ON i.ItemId = l.ItemId
         WHERE l.PoLineId = @poLineId AND l.PurchaseOrderId = @poId`,
        { poLineId: line.poLineId, poId }
      );
      if (!row) {
        throw new HttpError(400, `Line ${line.poLineId} is not on ${po.PoNumber}.`);
      }
      if (line.quantity > row.Outstanding) {
        throw new HttpError(400, `${row.Code}: only ${row.Outstanding} still to receive on ${po.PoNumber}.`);
      }
      const { changes } = db.run(
        `UPDATE POLine SET QtyReceived = ROUND(QtyReceived + @quantity, 2)
         WHERE PoLineId = @poLineId AND ROUND(QtyReceived + @quantity, 2) <= Quantity`,
        { quantity: line.quantity, poLineId: line.poLineId }
      );
      if (changes === 0) {
        throw new HttpError(409, 'The received quantity changed while saving. Please try again.');
      }
      received.push({ poLineId: line.poLineId, itemId: row.ItemId, quantity: line.quantity });
    }

    const countRow = db.get(
      'SELECT COUNT(*) AS n FROM POLine WHERE PurchaseOrderId = @poId AND ROUND(Quantity - QtyReceived, 2) > 0',
      { poId }
    );
    const poStatus = countRow.n === 0 ? 'closed' : 'partly_delivered';
    if (poStatus !== po.Status) {
      db.run('UPDATE PurchaseOrder SET Status = @poStatus WHERE PurchaseOrderId = @poId', { poStatus, poId });
      addDocHistory('PO', poId, po.Status, poStatus, userId, reportNumber ? `Received on ${reportNumber}` : null);
    }
    return { poId, poNumber: po.PoNumber, poStatus, projectId: po.ProjectId, requisitionId: po.RequisitionId, lines: received };
  });
}

module.exports = { recordPoReceipt };
