// Inventory step of the flowchart: "Stock sufficient?"
//   Yes: reserve the requested quantity for the project.
//   No:  reserve what is available and record the shortage.
// Runs inside the approval transaction, so approval and reservation succeed or fail together.
const { sql } = require('../db');
const { planReservation } = require('./stockRules');

// Returns the shortages: [{ itemId, shortQty }]. Empty when everything was reserved.
async function reserveForRequisition(tx, requisitionId) {
  const lines = (
    await new sql.Request(tx)
      .input('id', sql.Int, requisitionId)
      // Items are always handled in the same order, so two approvals can never lock each other.
      .query('SELECT LineId, ItemId, Quantity FROM dbo.RequisitionLine WHERE RequisitionId = @id ORDER BY ItemId')
  ).recordset;

  const shortages = [];
  for (const line of lines) {
    // UPDLOCK holds this item until the transaction ends, so two approvals cannot reserve the same units.
    const stock = await new sql.Request(tx)
      .input('itemId', sql.Int, line.ItemId)
      .query('SELECT OnHand - Reserved AS Available FROM dbo.Item WITH (UPDLOCK, ROWLOCK) WHERE ItemId = @itemId');
    const { reserve, short } = planReservation(line.Quantity, stock.recordset[0].Available);

    if (reserve > 0) {
      await new sql.Request(tx)
        .input('itemId', sql.Int, line.ItemId)
        .input('reserve', sql.Decimal(12, 2), reserve)
        .query('UPDATE dbo.Item SET Reserved = Reserved + @reserve WHERE ItemId = @itemId');
    }
    await new sql.Request(tx)
      .input('lineId', sql.Int, line.LineId)
      .input('reserve', sql.Decimal(12, 2), reserve)
      .input('short', sql.Decimal(12, 2), short)
      .query('UPDATE dbo.RequisitionLine SET QtyReserved = @reserve, QtyShort = @short WHERE LineId = @lineId');
    if (short > 0) shortages.push({ itemId: line.ItemId, shortQty: short });
  }
  return shortages;
}

module.exports = { reserveForRequisition };
