// Validation rules for material requisition forms.
const { HttpError } = require('./errors');
const { hasTwoDecimals } = require('./stockRules');

const URGENCY = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['pending', 'approved', 'returned', 'cancelled', 'partly_fulfilled', 'fulfilled'];

function padTwo(n) {
  return String(n).padStart(2, '0');
}

function todayString(d = new Date()) {
  const year = d.getFullYear();
  const month = padTwo(d.getMonth() + 1);
  const day = padTwo(d.getDate());
  return `${year}-${month}-${day}`;
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

function validateRfInput(body, today = todayString()) {
  const input = body || {};
  const projectId = Number(input.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new HttpError(400, 'Choose a project.');
  }

  const dateNeeded = String(input.dateNeeded || '');
  if (!isRealDate(dateNeeded) || dateNeeded < today) {
    throw new HttpError(400, 'Enter the date needed. It must be today or later.');
  }

  const urgency = String(input.urgency || '');
  if (!URGENCY.includes(urgency)) {
    throw new HttpError(400, 'Choose an urgency level.');
  }

  const purpose = String(input.purpose || '').trim();
  if (!purpose || purpose.length > 300) {
    throw new HttpError(400, 'Enter the purpose, up to 300 characters.');
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new HttpError(400, 'Add at least one item.');
  }
  if (input.lines.length > 100) {
    throw new HttpError(400, 'A requisition can have at most 100 items.');
  }

  const lines = [];
  const seen = new Set();
  for (const line of input.lines) {
    const itemId = Number(line && line.itemId);
    const quantity = Number(line && line.quantity);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw new HttpError(400, 'Choose an item on every line.');
    }
    if (!(quantity > 0) || quantity > 1000000 || !hasTwoDecimals(quantity)) {
      throw new HttpError(400, 'Each quantity must be above zero, with at most 2 decimals.');
    }
    if (seen.has(itemId)) {
      throw new HttpError(400, 'An item is listed twice. Combine it into one line.');
    }
    seen.add(itemId);
    lines.push({ itemId, quantity });
  }

  return { projectId, dateNeeded, urgency, purpose, lines };
}

// A returned RF can only be revised once.
function canRevise(rf) {
  return rf.Status === 'returned' && rf.RevisionCount < 1;
}

module.exports = { URGENCY, STATUSES, todayString, validateRfInput, canRevise };
