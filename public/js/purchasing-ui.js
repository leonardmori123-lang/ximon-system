// Shared helper functions and formatting utilities for purchasing pages.
const PR_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

const PR_CLASSES = {
  pending: 'text-bg-warning',
  approved: 'text-bg-success',
  on_hold: 'text-bg-info',
  cancelled: 'text-bg-secondary',
};

function prBadge(status) {
  return h('span', { class: `badge ${PR_CLASSES[status] || 'text-bg-light'}` }, PR_LABELS[status] || status);
}

// Formats centavos as a standard peso string with two decimal places.
function pesos(centavos) {
  return (centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pesosPlain(centavos) {
  return (centavos / 100).toFixed(2);
}

// Converts user-typed peso amount to whole centavos.
function toCentavos(text) {
  const clean = String(text).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    return null;
  }
  const centavos = Math.round(Number(clean) * 100);
  if (centavos > 0) {
    return centavos;
  }
  return null;
}

const PRICE_ERROR = 'Enter a price above zero, with at most 2 decimals.';

function toBudgetCentavos(text) {
  const clean = String(text).trim().replace(/,/g, '');
  if (clean === '') {
    return 0;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    return null;
  }
  return Math.round(Number(clean) * 100);
}

const PO_LABELS = {
  open: 'Open',
  partly_delivered: 'Partly delivered',
  closed: 'Closed',
};

const PO_CLASSES = {
  open: 'text-bg-primary',
  partly_delivered: 'text-bg-warning',
  closed: 'text-bg-success',
};

function poBadge(status) {
  return h('span', { class: `badge ${PO_CLASSES[status] || 'text-bg-light'}` }, PO_LABELS[status] || status);
}

function pesosOrDash(centavos) {
  if (centavos) {
    return pesos(centavos);
  }
  return '-';
}

function toPercent(text) {
  const clean = String(text).trim();
  if (clean === '') {
    return 0;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    return null;
  }
  const percent = Number(clean);
  if (percent <= 100) {
    return percent;
  }
  return null;
}

// Rounds discount to nearest whole centavo.
function discountOf(subtotalCentavos, percent) {
  return Math.round((subtotalCentavos * Math.round(percent * 100)) / 10000);
}

const PERCENT_ERROR = 'Enter the discount as a percent from 0 to 100, with at most 2 decimals.';
