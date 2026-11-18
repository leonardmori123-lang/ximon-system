// Small helpers shared by the Purchasing pages. Load it after common.js.

// Purchase requisition statuses have their own labels and colours (common.js has the RF ones).
const PR_LABELS = { pending: 'Pending approval', approved: 'Approved', on_hold: 'On hold', cancelled: 'Cancelled' };
const PR_CLASSES = { pending: 'text-bg-warning', approved: 'text-bg-success', on_hold: 'text-bg-info', cancelled: 'text-bg-secondary' };

function prBadge(status) {
  return h('span', { class: `badge ${PR_CLASSES[status] || 'text-bg-light'}` }, PR_LABELS[status] || status);
}

// Money is saved as whole centavos and shown as pesos: 53266 is 532.66.
function pesos(centavos) {
  return (centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// For an input box: 53266 becomes "532.66", with no thousands comma.
function pesosPlain(centavos) {
  return (centavos / 100).toFixed(2);
}

// Turns what the purchaser typed ("1,234.5") into whole centavos (123450).
// Returns null when it is not an amount with at most 2 decimals, or is zero.
function toCentavos(text) {
  const clean = String(text).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const centavos = Math.round(Number(clean) * 100);
  return centavos > 0 ? centavos : null;
}

const PRICE_ERROR = 'Enter a price above zero, with at most 2 decimals.';
