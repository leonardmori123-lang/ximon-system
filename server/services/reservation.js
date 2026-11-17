// Inventory step of the flowchart: "Stock sufficient?"
//   Yes: reserve the requested quantity for the project.
//   No:  reserve what is available and record the shortage.
// Runs inside the approval transaction, so approval and reservation succeed or fail together.
const db = require('../db');
const { planReservation } = require('./stockRules');

// Returns the shortages: [{ itemId, shortQty }]. Empty when everything was reserved.
function reserveForRequisition(requisitionId) {
  // Items are always handled in the same order. SQLite also lets only one write run at a time,
  // so two approvals can never reserve the same units.
  const lines = db.all(
    'SELECT LineId, ItemId, Quantity FROM RequisitionLine WHERE RequisitionId = @requisitionId ORDER BY ItemId',
    { requisitionId }
  );

  const shortages = [];
  for (const line of lines) {
    const stock = db.get('SELECT ROUND(OnHand - Reserved, 2) AS Available FROM Item WHERE ItemId = @itemId', { itemId: line.ItemId });
    const { reserve, short } = planReservation(line.Quantity, stock.Available);

    if (reserve > 0) {
      db.run('UPDATE Item SET Reserved = ROUND(Reserved + @reserve, 2) WHERE ItemId = @itemId', { reserve, itemId: line.ItemId });
    }
    db.run('UPDATE RequisitionLine SET QtyReserved = @reserve, QtyShort = @short WHERE LineId = @lineId',
      { reserve, short, lineId: line.LineId });
    if (short > 0) shortages.push({ itemId: line.ItemId, shortQty: short });
  }
  return shortages;
}

module.exports = { reserveForRequisition };
