// Handoffs between modules. Each function belongs to the module that RECEIVES the call.
//
// createPurchaseRequisition belongs to Purchasing. Replace the body below with the real one:
// build the purchase requisition and its lines with new sql.Request(tx), then return what
// Inventory should remember (for example { prNumber }). It receives the open transaction `tx`,
// so the purchase requisition is saved together with the approval. If it throws, the whole
// approval is rolled back.
//
//   input: { requisitionId, rfNumber, projectId, lines: [{ itemId, shortQty }] }
async function createPurchaseRequisition(tx, input) { // eslint-disable-line no-unused-vars
  return null; // Purchasing is not built yet. The shortage stays visible on the RF.
}

module.exports = { createPurchaseRequisition };
