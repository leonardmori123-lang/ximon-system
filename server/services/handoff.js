// Handoffs between modules. Each function belongs to the module that RECEIVES the call.
//
// createPurchaseRequisition belongs to Purchasing. Replace the body below with the real one:
// save the purchase requisition and its lines with db.run(...) (see server/db.js), then return what
// Inventory should remember (for example { prNumber }). It runs inside the approval transaction,
// so the purchase requisition is saved together with the approval. If it throws, the whole
// approval is undone.
//
//   input: { requisitionId, rfNumber, projectId, lines: [{ itemId, shortQty }] }
function createPurchaseRequisition(input) { // eslint-disable-line no-unused-vars
  return null; // Purchasing is not built yet. The shortage stays visible on the RF.
}

module.exports = { createPurchaseRequisition };
