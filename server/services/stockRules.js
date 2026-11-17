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

module.exports = { planReservation };
