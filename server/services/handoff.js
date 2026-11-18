// Handoffs between modules. Each function belongs to the module that RECEIVES the call.
//
// createPurchaseRequisition belongs to Purchasing. Inventory calls it inside the owner's approval,
// so the purchase requisition is saved together with the approval. If it throws, the whole approval
// is undone, so it throws only for real errors. It must stay synchronous (no async, no await).
const db = require('../db');
const { nextNumber } = require('./numbering');
const { addDocHistory } = require('./history');
const { notifyRole } = require('./notifications');

// input: { requisitionId, rfNumber, projectId, lines: [{ itemId, shortQty }], userId }
// Returns { prNumber }, which Inventory shows in the approval result.
function createPurchaseRequisition({ requisitionId, rfNumber, projectId, lines, userId }) {
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
