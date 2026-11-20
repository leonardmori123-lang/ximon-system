// Purchasing rules that need no database, so they are easy to test.
// Money is whole centavos: PHP 532.66 is 53266.
const { HttpError } = require('./errors');
const { todayString } = require('./rfRules');

const PR_STATUSES = ['pending', 'approved', 'on_hold', 'cancelled'];
const PO_STATUSES = ['open', 'partly_delivered', 'closed'];
// The purchaser can change the supplier and prices only while the owner has not approved.
const PRICEABLE_STATUSES = ['pending', 'on_hold'];
const MAX_PRICE_CENTAVOS = 1000000000; // PHP 10,000,000 for one unit
const MAX_REASON_LENGTH = 300; // same limit as the reason for returning an RF

// The owner's three decisions: where each may start, where it ends, and whether it needs a reason.
// "done" is the word used in messages ("it cannot be approved").
const DECISIONS = {
  approve: { from: ['pending'], to: 'approved', needsReason: false, done: 'approved' },
  hold: { from: ['pending'], to: 'on_hold', needsReason: true, done: 'put on hold' },
  cancel: { from: ['pending', 'on_hold'], to: 'cancelled', needsReason: true, done: 'cancelled' },
};

// Turns an empty text into null, and refuses text longer than the limit.
function optionalText(value, max, label) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > max) throw new HttpError(400, `${label} can be up to ${max} characters.`);
  return text || null;
}

// Checks the supplier form.
function validateSupplierInput(body, { creating }) {
  const input = body || {};
  const supplier = {};

  supplier.name = String(input.name == null ? '' : input.name).trim();
  if (!supplier.name || supplier.name.length > 100) throw new HttpError(400, 'Enter the supplier name, up to 100 characters.');

  supplier.contactPerson = optionalText(input.contactPerson, 100, 'Contact person');
  supplier.phone = optionalText(input.phone, 40, 'Phone');
  supplier.email = optionalText(input.email, 100, 'Email');
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) {
    throw new HttpError(400, 'Enter a valid email address, or leave it empty.');
  }
  supplier.address = optionalText(input.address, 200, 'Address');
  supplier.paymentTerms = optionalText(input.paymentTerms, 100, 'Payment terms');

  supplier.leadTimeDays = Number(input.leadTimeDays === undefined || input.leadTimeDays === '' ? 0 : input.leadTimeDays);
  if (!Number.isInteger(supplier.leadTimeDays) || supplier.leadTimeDays < 0 || supplier.leadTimeDays > 1000) {
    throw new HttpError(400, 'Lead time must be a whole number of days, 0 to 1000.');
  }

  supplier.isActive = creating ? true : input.isActive !== false;
  return supplier;
}

// A unit price in whole centavos, above zero.
function checkUnitPrice(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_PRICE_CENTAVOS) {
    throw new HttpError(400, 'Enter a unit price above zero, up to PHP 10,000,000, with at most 2 decimals.');
  }
  return value;
}

// The prices sent for a purchase requisition must cover every one of its lines, once each.
// Returns [{ prLineId, unitPriceCentavos }].
function validatePriceLines(lines, prLineIds) {
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'Enter a price for every line.');
  const seen = new Set();
  const checked = lines.map((line) => {
    const prLineId = Number((line || {}).prLineId);
    if (!prLineIds.includes(prLineId)) throw new HttpError(400, 'One of the lines does not belong to this purchase requisition.');
    if (seen.has(prLineId)) throw new HttpError(400, 'A line was sent twice.');
    seen.add(prLineId);
    return { prLineId, unitPriceCentavos: checkUnitPrice(line.unitPriceCentavos) };
  });
  if (checked.length !== prLineIds.length) throw new HttpError(400, 'Enter a price for every line.');
  return checked;
}

// Same rounding as the CHECK on POLine: whole centavos, half up.
function lineTotal(quantity, unitPriceCentavos) {
  return Math.round(Number(quantity) * unitPriceCentavos);
}

// Total of a purchase requisition, or null while any line has no price yet.
function prTotal(lines) {
  if (lines.length === 0 || lines.some((l) => l.UnitPriceCentavos == null)) return null;
  return lines.reduce((sum, l) => sum + lineTotal(l.ShortQty, l.UnitPriceCentavos), 0);
}

// The reason for holding or cancelling: required, trimmed, up to 300 characters.
function checkReason(value, action) {
  const reason = String(value == null ? '' : value).trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    const what = action === 'hold' ? 'putting it on hold' : 'cancelling it';
    throw new HttpError(400, `Write the reason for ${what}, up to ${MAX_REASON_LENGTH} characters.`);
  }
  return reason;
}

// Which decisions the owner can take on a purchase requisition right now.
// Approve needs a supplier and a price on every line (isPriced), so the screen can hide the button
// and the route can refuse it.
function ownerDecisions(status, isPriced) {
  return Object.keys(DECISIONS).filter((action) => DECISIONS[action].from.includes(status) && (action !== 'approve' || isPriced));
}

// ---------- The purchase order ----------

// A real calendar date written as 2026-11-19 (2026-02-30 is not one).
function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// The date a supplier with this lead time can deliver, counted from today. Null when the lead time is
// not set (0 or empty), so the purchaser types the date.
function defaultDeliveryDate(leadTimeDays, today = todayString()) {
  if (!leadTimeDays) return null;
  const [y, m, d] = today.split('-').map(Number);
  return todayString(new Date(y, m - 1, d + Number(leadTimeDays)));
}

// Checks what the purchaser types when making a PO. A box left empty comes back as null (or 0 for the
// discount), and the service then fills it from the supplier or the project.
function validatePoInput(body, today = todayString()) {
  const input = body || {};

  let discountPercent = 0;
  const raw = input.discountPercent;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') discountPercent = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || Math.round(discountPercent * 100) / 100 !== discountPercent) {
    throw new HttpError(400, 'Enter the discount as a percent from 0 to 100, with at most 2 decimals.');
  }

  const expected = String(input.expectedDeliveryDate == null ? '' : input.expectedDeliveryDate).trim();
  if (expected && (!isRealDate(expected) || expected < today)) {
    throw new HttpError(400, 'Enter the expected delivery date as a real date, today or later.');
  }

  return {
    discountPercent,
    deliveryPoint: optionalText(input.deliveryPoint, 200, 'Delivery point'),
    expectedDeliveryDate: expected || null,
    paymentTerms: optionalText(input.paymentTerms, 100, 'Payment terms'),
  };
}

// The discount in whole centavos, half up. The percent has at most 2 decimals, so it is turned into
// hundredths of a percent first. That keeps the rounding exact (no 0.1 + 0.2 style drift).
function poDiscount(subtotalCentavos, discountPercent) {
  return Math.round((subtotalCentavos * Math.round(discountPercent * 100)) / 10000);
}

// Subtotal, discount and total of a PO from its line totals. The PO has no other discount and no
// shipping yet (both stay 0), so total = subtotal - discount.
function poTotals(lineTotals, discountPercent) {
  const subtotalCentavos = lineTotals.reduce((sum, t) => sum + t, 0);
  const discountCentavos = poDiscount(subtotalCentavos, discountPercent);
  return { subtotalCentavos, discountCentavos, totalCentavos: subtotalCentavos - discountCentavos };
}

module.exports = {
  PR_STATUSES, PO_STATUSES, PRICEABLE_STATUSES, MAX_PRICE_CENTAVOS, MAX_REASON_LENGTH, DECISIONS,
  validateSupplierInput, checkUnitPrice, validatePriceLines, lineTotal, prTotal, checkReason, ownerDecisions,
  validatePoInput, defaultDeliveryDate, poDiscount, poTotals,
};
