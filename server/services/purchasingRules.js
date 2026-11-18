// Purchasing rules that need no database, so they are easy to test.
// Money is whole centavos: PHP 532.66 is 53266.
const { HttpError } = require('./errors');

const PR_STATUSES = ['pending', 'approved', 'on_hold', 'cancelled'];
// The purchaser can change the supplier and prices only while the owner has not approved.
const PRICEABLE_STATUSES = ['pending', 'on_hold'];
const MAX_PRICE_CENTAVOS = 1000000000; // PHP 10,000,000 for one unit

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

module.exports = {
  PR_STATUSES, PRICEABLE_STATUSES, MAX_PRICE_CENTAVOS,
  validateSupplierInput, checkUnitPrice, validatePriceLines, lineTotal, prTotal,
};
