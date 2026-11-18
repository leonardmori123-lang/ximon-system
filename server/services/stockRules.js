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

module.exports = { hasTwoDecimals, planReservation, planAllocation };
