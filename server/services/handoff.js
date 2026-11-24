// Inter-module handoff for creating purchase requisitions from shortages.
const db = require('../db');
const { nextNumber } = require('./numbering');
const { addDocHistory } = require('./history');
const { notifyRole } = require('./notifications');

// Runs inside the caller's approval transaction.
function createPurchaseRequisition(options) {
  const requisitionId = options.requisitionId;
  const rfNumber = options.rfNumber;
  const projectId = options.projectId;
  const lines = options.lines;
  const userId = options.userId;

  const prNumber = nextNumber('PR');
  const { lastId } = db.run(
    `INSERT INTO PurchaseRequisition (PrNumber, RequisitionId, ProjectId)
     VALUES (@prNumber, @requisitionId, @projectId)`,
    { prNumber, requisitionId, projectId }
  );
  for (const line of lines) {
    db.run(
      `INSERT INTO PRLine (PurchaseRequisitionId, ItemId, ShortQty)
       VALUES (@prId, @itemId, @shortQty)`,
      { prId: lastId, itemId: line.itemId, shortQty: line.shortQty }
    );
  }
  addDocHistory('PR', lastId, null, 'pending', userId, null);
  notifyRole('purchaser', `${prNumber} was created from ${rfNumber}. Choose a supplier.`, `/pr.html?id=${lastId}`);
  return { prNumber };
}

module.exports = { createPurchaseRequisition };
