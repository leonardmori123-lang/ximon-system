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

// For the project budget box: "4,500" becomes 450000. An empty box or 0 means no budget (0).
// Returns null when it is not an amount with at most 2 decimals.
function toBudgetCentavos(text) {
  const clean = String(text).trim().replace(/,/g, '');
  if (clean === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

// Purchase order statuses.
const PO_LABELS = { open: 'Open', partly_delivered: 'Partly delivered', closed: 'Closed' };
const PO_CLASSES = { open: 'text-bg-primary', partly_delivered: 'text-bg-warning', closed: 'text-bg-success' };

function poBadge(status) {
  return h('span', { class: `badge ${PO_CLASSES[status] || 'text-bg-light'}` }, PO_LABELS[status] || status);
}

// The PO sample shows a dash for an amount of zero (other discounts, shipping).
function pesosOrDash(centavos) {
  return centavos ? pesos(centavos) : '-';
}

// Turns what the purchaser typed in the discount box into a percent. An empty box is 0.
// Returns null when it is not a percent from 0 to 100 with at most 2 decimals.
function toPercent(text) {
  const clean = String(text).trim();
  if (clean === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const percent = Number(clean);
  return percent <= 100 ? percent : null;
}

// The discount in whole centavos, half up. The same sum the server does, so the preview matches what is saved.
function discountOf(subtotalCentavos, percent) {
  return Math.round((subtotalCentavos * Math.round(percent * 100)) / 10000);
}

const PERCENT_ERROR = 'Enter the discount as a percent from 0 to 100, with at most 2 decimals.';
