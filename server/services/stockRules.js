// Stock calculation rules for reservations, allocations, and low stock warnings.

// Checks if a number has at most 2 decimal places.
function hasTwoDecimals(n) {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

// Reserve available stock up to the requested quantity; remainder is the shortage.
function planReservation(requested, available) {
  const want = Number(requested);
  const have = Math.max(Number(available), 0);
  const reserve = Math.min(want, have);
  const short = Math.round((want - reserve) * 100) / 100;
  return { reserve, short };
}

// Allocate received stock to cover what the requisition still lacks.
function planAllocation(received, qtyShort, available) {
  const give = Math.min(Number(received), Number(qtyShort), Math.max(Number(available), 0));
  return Math.max(Math.round(give * 100) / 100, 0);
}

// An item is low when active, has a reorder point, and available stock is at or below it.
function isLowStock(item) {
  if (!item.IsActive) {
    return false;
  }
  const reorderPoint = Number(item.ReorderPoint);
  if (!(reorderPoint > 0)) {
    return false;
  }
  const available = Math.round((Number(item.OnHand) - Number(item.Reserved)) * 100) / 100;
  return available <= reorderPoint;
}

module.exports = { hasTwoDecimals, planReservation, planAllocation, isLowStock };
