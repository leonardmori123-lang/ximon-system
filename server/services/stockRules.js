// True when n is a real number with at most 2 decimals (2.5 and 3 pass, 1.005 does not).
function hasTwoDecimals(n) {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

// Pure rule for reserving stock (no database, easy to test).
// Reserve what is available, never more than was asked, never a negative amount.
// Whatever is left over is the shortage that needs a purchase requisition.
function planReservation(requested, available) {
  const want = Number(requested);
  const have = Math.max(Number(available), 0);
  const reserve = Math.min(want, have);
  const short = Math.round((want - reserve) * 100) / 100;
  return { reserve, short };
}

// Pure rule for giving delivered stock to the RF behind the purchase requisition.
// Give what the RF still lacks, never more than arrived, never more than is free on the shelf.
// Anything left over stays on the shelf as free stock.
function planAllocation(received, qtyShort, available) {
  const give = Math.min(Number(received), Number(qtyShort), Math.max(Number(available), 0));
  return Math.max(Math.round(give * 100) / 100, 0);
}

// Pure rule for the "Low" badge on the Item list. Takes one row of the Item list.
// An item is Low when it is active, a reorder point is set (0 means none), and Available
// (on hand minus reserved, because reserved units are already promised) is at or below it.
function isLowStock(item) {
  if (!item.IsActive) return false;
  const reorderPoint = Number(item.ReorderPoint);
  if (!(reorderPoint > 0)) return false;
  const available = Math.round((Number(item.OnHand) - Number(item.Reserved)) * 100) / 100;
  return available <= reorderPoint;
}

module.exports = { hasTwoDecimals, planReservation, planAllocation, isLowStock };
