// Inventory reservation logic for requisition approval.
const db = require('../db');
const { planReservation } = require('./stockRules');

// Runs inside the caller's approval transaction.
function reserveForRequisition(requisitionId) {
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
    db.run(
      'UPDATE RequisitionLine SET QtyReserved = @reserve, QtyShort = @short WHERE LineId = @lineId',
      { reserve, short, lineId: line.LineId }
    );
    if (short > 0) {
      shortages.push({ itemId: line.ItemId, shortQty: short });
    }
  }
  return shortages;
}

module.exports = { reserveForRequisition };
