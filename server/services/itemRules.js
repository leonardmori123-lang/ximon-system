const { HttpError } = require('./errors');
const { hasTwoDecimals } = require('./stockRules');

// Checks the item form. Quantities on hand and reserved are never part of it.
function validateItemInput(body, { creating }) {
  const input = body || {};
  const item = {};

  if (creating) {
    item.code = String(input.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(item.code)) {
      throw new HttpError(400, 'Item code: 2 to 30 characters, letters, digits and dashes only, like HDPE-001.');
    }
  }

  item.description = String(input.description || '').trim();
  if (!item.description || item.description.length > 200) throw new HttpError(400, 'Enter a description, up to 200 characters.');

  item.unit = String(input.unit || '').trim();
  if (!item.unit || item.unit.length > 20) throw new HttpError(400, 'Enter a unit, such as pc, m or kg.');

  const location = String(input.location || '').trim();
  if (location.length > 60) throw new HttpError(400, 'Location can be up to 60 characters.');
  item.location = location || null;

  item.reorderPoint = Number(input.reorderPoint === undefined || input.reorderPoint === '' ? 0 : input.reorderPoint);
  if (!(item.reorderPoint >= 0) || item.reorderPoint > 1000000 || !hasTwoDecimals(item.reorderPoint)) {
    throw new HttpError(400, 'Reorder point must be zero or more, with at most 2 decimals.');
  }

  item.leadTimeDays = Number(input.leadTimeDays === undefined || input.leadTimeDays === '' ? 0 : input.leadTimeDays);
  if (!Number.isInteger(item.leadTimeDays) || item.leadTimeDays < 0 || item.leadTimeDays > 1000) {
    throw new HttpError(400, 'Lead time must be a whole number of days, 0 to 1000.');
  }

  item.isTool = Boolean(input.isTool);
  item.isActive = creating ? true : input.isActive !== false;
  return item;
}

module.exports = { validateItemInput };
