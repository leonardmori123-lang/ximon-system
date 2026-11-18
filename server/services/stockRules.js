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

module.exports = { planReservation, planAllocation };
