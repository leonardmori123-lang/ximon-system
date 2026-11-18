// Pure rules for the Requisition Form: no database in here, so they are easy to test.
const { HttpError } = require('./errors');
const { hasTwoDecimals } = require('./stockRules');

const URGENCY = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['pending', 'approved', 'returned', 'cancelled', 'partly_fulfilled', 'fulfilled'];

function todayString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// Checks what the foreman typed and returns clean values, or throws a 400 with a plain message.
function validateRfInput(body, today = todayString()) {
  const input = body || {};
  const projectId = Number(input.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new HttpError(400, 'Choose a project.');

  const dateNeeded = String(input.dateNeeded || '');
  if (!isRealDate(dateNeeded) || dateNeeded < today) {
    throw new HttpError(400, 'Enter the date needed. It must be today or later.');
  }

  const urgency = String(input.urgency || '');
  if (!URGENCY.includes(urgency)) throw new HttpError(400, 'Choose an urgency level.');

  const purpose = String(input.purpose || '').trim();
  if (!purpose || purpose.length > 300) throw new HttpError(400, 'Enter the purpose, up to 300 characters.');

  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new HttpError(400, 'Add at least one item.');
  if (input.lines.length > 100) throw new HttpError(400, 'A requisition can have at most 100 items.');

  const seen = new Set();
  const lines = input.lines.map((line) => {
    const itemId = Number(line && line.itemId);
    const quantity = Number(line && line.quantity);
    if (!Number.isInteger(itemId) || itemId <= 0) throw new HttpError(400, 'Choose an item on every line.');
    if (!(quantity > 0) || quantity > 1000000 || !hasTwoDecimals(quantity)) {
      throw new HttpError(400, 'Each quantity must be above zero, with at most 2 decimals.');
    }
    if (seen.has(itemId)) throw new HttpError(400, 'An item is listed twice. Combine it into one line.');
    seen.add(itemId);
    return { itemId, quantity };
  });

  return { projectId, dateNeeded, urgency, purpose, lines };
}

// A returned RF may be revised once. After that the requestor can only cancel it.
function canRevise(rf) {
  return rf.Status === 'returned' && rf.RevisionCount < 1;
}

module.exports = { URGENCY, STATUSES, todayString, validateRfInput, canRevise };
