// Inventory item management and queries.
const db = require('../db');
const { HttpError } = require('./errors');
const { validateItemInput } = require('./itemRules');
const { isLowStock } = require('./stockRules');

const ITEM_COLUMNS = `ItemId, Code, Description, Unit, Location, OnHand, Reserved,
  ROUND(OnHand - Reserved, 2) AS Available, ReorderPoint, LeadTimeDays, IsTool, IsActive`;

function listItems(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const whereClause = includeInactive ? '' : 'WHERE IsActive = 1';
  const rows = db.all(`SELECT ${ITEM_COLUMNS} FROM Item ${whereClause} ORDER BY Code`);
  const items = [];
  for (const row of rows) {
    items.push({
      ...row,
      IsLow: isLowStock(row),
    });
  }
  return items;
}

function createItem(body) {
  const item = validateItemInput(body, { creating: true });
  try {
    const { lastId } = db.run(
      `INSERT INTO Item (Code, Description, Unit, Location, ReorderPoint, LeadTimeDays, IsTool)
       VALUES (@code, @description, @unit, @location, @reorderPoint, @leadTimeDays, @isTool)`,
      {
        code: item.code,
        description: item.description,
        unit: item.unit,
        location: item.location,
        reorderPoint: item.reorderPoint,
        leadTimeDays: item.leadTimeDays,
        isTool: item.isTool,
      }
    );
    return { id: lastId };
  } catch (err) {
    if (db.isUniqueError(err)) {
      throw new HttpError(409, 'That item code is already used.');
    }
    throw err;
  }
}

function updateItem(id, body) {
  const item = validateItemInput(body, { creating: false });
  const { changes } = db.run(
    `UPDATE Item SET Description = @description, Unit = @unit, Location = @location,
       ReorderPoint = @reorderPoint, LeadTimeDays = @leadTimeDays, IsTool = @isTool, IsActive = @isActive
     WHERE ItemId = @id`,
    {
      id,
      description: item.description,
      unit: item.unit,
      location: item.location,
      reorderPoint: item.reorderPoint,
      leadTimeDays: item.leadTimeDays,
      isTool: item.isTool,
      isActive: item.isActive,
    }
  );
  if (changes === 0) {
    throw new HttpError(404, 'Item not found.');
  }
  return { id };
}

module.exports = { listItems, createItem, updateItem };
