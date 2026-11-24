// Validation and calculation rules for purchasing documents and supplier records.
const { HttpError } = require('./errors');
const { todayString } = require('./rfRules');

const PR_STATUSES = ['pending', 'approved', 'on_hold', 'cancelled'];
const PO_STATUSES = ['open', 'partly_delivered', 'closed'];
const PRICEABLE_STATUSES = ['pending', 'on_hold'];
const MAX_PRICE_CENTAVOS = 1000000000;
const MAX_REASON_LENGTH = 300;

// Workflow states for owner decisions on purchase requisitions.
const DECISIONS = {
  approve: { from: ['pending'], to: 'approved', needsReason: false, done: 'approved' },
  hold: { from: ['pending'], to: 'on_hold', needsReason: true, done: 'put on hold' },
  cancel: { from: ['pending', 'on_hold'], to: 'cancelled', needsReason: true, done: 'cancelled' },
};

function optionalText(value, max, label) {
  const raw = value == null ? '' : value;
  const text = String(raw).trim();
  if (text.length > max) {
    throw new HttpError(400, `${label} can be up to ${max} characters.`);
  }
  return text || null;
}

function validateSupplierInput(body, options = {}) {
  const creating = Boolean(options.creating);
  const input = body || {};
  const supplier = {};

  const rawName = input.name == null ? '' : input.name;
  supplier.name = String(rawName).trim();
  if (!supplier.name || supplier.name.length > 100) {
    throw new HttpError(400, 'Enter the supplier name, up to 100 characters.');
  }

  supplier.contactPerson = optionalText(input.contactPerson, 100, 'Contact person');
  supplier.phone = optionalText(input.phone, 40, 'Phone');
  supplier.email = optionalText(input.email, 100, 'Email');
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) {
    throw new HttpError(400, 'Enter a valid email address, or leave it empty.');
  }
  supplier.address = optionalText(input.address, 200, 'Address');
  supplier.paymentTerms = optionalText(input.paymentTerms, 100, 'Payment terms');

  let leadTimeDays = 0;
  if (input.leadTimeDays !== undefined && input.leadTimeDays !== '') {
    leadTimeDays = Number(input.leadTimeDays);
  }
  supplier.leadTimeDays = leadTimeDays;
  if (!Number.isInteger(supplier.leadTimeDays) || supplier.leadTimeDays < 0 || supplier.leadTimeDays > 1000) {
    throw new HttpError(400, 'Lead time must be a whole number of days, 0 to 1000.');
  }

  if (creating) {
    supplier.isActive = true;
  } else {
    supplier.isActive = input.isActive !== false;
  }
  return supplier;
}

function checkUnitPrice(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_PRICE_CENTAVOS) {
    throw new HttpError(400, 'Enter a unit price above zero, up to PHP 10,000,000, with at most 2 decimals.');
  }
  return value;
}

function validatePriceLines(lines, prLineIds) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, 'Enter a price for every line.');
  }
  const seen = new Set();
  const checked = [];
  for (const line of lines) {
    const lineData = line || {};
    const prLineId = Number(lineData.prLineId);
    if (!prLineIds.includes(prLineId)) {
      throw new HttpError(400, 'One of the lines does not belong to this purchase requisition.');
    }
    if (seen.has(prLineId)) {
      throw new HttpError(400, 'A line was sent twice.');
    }
    seen.add(prLineId);
    checked.push({
      prLineId,
      unitPriceCentavos: checkUnitPrice(lineData.unitPriceCentavos),
    });
  }
  if (checked.length !== prLineIds.length) {
    throw new HttpError(400, 'Enter a price for every line.');
  }
  return checked;
}

// Rounds line total to the nearest whole centavo.
function lineTotal(quantity, unitPriceCentavos) {
  return Math.round(Number(quantity) * unitPriceCentavos);
}

function prTotal(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }
  let sum = 0;
  for (const line of lines) {
    if (line.UnitPriceCentavos == null) {
      return null;
    }
    sum += lineTotal(line.ShortQty, line.UnitPriceCentavos);
  }
  return sum;
}

function budgetCheck(budgetCentavos, committedCentavos, prTotalCentavos) {
  const budgetSet = budgetCentavos > 0;
  const remainingCentavos = budgetCentavos - committedCentavos;
  let overByCentavos = 0;
  if (budgetSet && prTotalCentavos != null) {
    overByCentavos = Math.max(0, prTotalCentavos - remainingCentavos);
  }
  return {
    budgetSet,
    budgetCentavos,
    committedCentavos,
    remainingCentavos,
    prTotalCentavos: prTotalCentavos == null ? null : prTotalCentavos,
    overByCentavos,
    overBudget: overByCentavos > 0,
  };
}

function checkReason(value, action) {
  const raw = value == null ? '' : value;
  const reason = String(raw).trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    const what = action === 'hold' ? 'putting it on hold' : 'cancelling it';
    throw new HttpError(400, `Write the reason for ${what}, up to ${MAX_REASON_LENGTH} characters.`);
  }
  return reason;
}

function checkOwnerNote(value) {
  return optionalText(value, MAX_REASON_LENGTH, 'The note');
}

function formatPesos(centavos) {
  return (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ownerDecisions(status, isPriced) {
  const allowed = [];
  for (const action of Object.keys(DECISIONS)) {
    const rule = DECISIONS[action];
    if (rule.from.includes(status)) {
      if (action !== 'approve' || isPriced) {
        allowed.push(action);
      }
    }
  }
  return allowed;
}

function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const parts = text.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function defaultDeliveryDate(leadTimeDays, today = todayString()) {
  if (!leadTimeDays) {
    return null;
  }
  const parts = today.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2] + Number(leadTimeDays));
  return todayString(date);
}

function validatePoInput(body, today = todayString()) {
  const input = body || {};

  let discountPercent = 0;
  const raw = input.discountPercent;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    discountPercent = typeof raw === 'number' ? raw : Number(String(raw).trim());
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || Math.round(discountPercent * 100) / 100 !== discountPercent) {
    throw new HttpError(400, 'Enter the discount as a percent from 0 to 100, with at most 2 decimals.');
  }

  const rawExpected = input.expectedDeliveryDate == null ? '' : input.expectedDeliveryDate;
  const expected = String(rawExpected).trim();
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

// Rounds discount to whole centavos using hundredths of a percent.
function poDiscount(subtotalCentavos, discountPercent) {
  return Math.round((subtotalCentavos * Math.round(discountPercent * 100)) / 10000);
}

function poTotals(lineTotals, discountPercent) {
  let subtotalCentavos = 0;
  for (const amount of lineTotals) {
    subtotalCentavos += amount;
  }
  const discountCentavos = poDiscount(subtotalCentavos, discountPercent);
  const totalCentavos = subtotalCentavos - discountCentavos;
  return { subtotalCentavos, discountCentavos, totalCentavos };
}

module.exports = {
  PR_STATUSES,
  PO_STATUSES,
  PRICEABLE_STATUSES,
  MAX_PRICE_CENTAVOS,
  MAX_REASON_LENGTH,
  DECISIONS,
  validateSupplierInput,
  checkUnitPrice,
  validatePriceLines,
  lineTotal,
  prTotal,
  budgetCheck,
  checkReason,
  checkOwnerNote,
  formatPesos,
  ownerDecisions,
  validatePoInput,
  defaultDeliveryDate,
  poDiscount,
  poTotals,
};
