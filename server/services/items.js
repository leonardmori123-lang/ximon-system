const { sql, query } = require('../db');
const { HttpError } = require('./errors');
const { validateItemInput } = require('./itemRules');

const ITEM_COLUMNS = `ItemId, Code, Description, Unit, Location, OnHand, Reserved,
  OnHand - Reserved AS Available, ReorderPoint, LeadTimeDays, IsTool, IsActive`;

async function listItems({ includeInactive }) {
  return query(
    `SELECT ${ITEM_COLUMNS} FROM dbo.Item ${includeInactive ? '' : 'WHERE IsActive = 1'} ORDER BY Code`
  );
}

async function createItem(body) {
  const item = validateItemInput(body, { creating: true });
  try {
    const rows = await query(
      `INSERT INTO dbo.Item (Code, Description, Unit, Location, ReorderPoint, LeadTimeDays, IsTool)
       OUTPUT inserted.ItemId
       VALUES (@code, @description, @unit, @location, @reorderPoint, @leadTimeDays, @isTool)`,
      {
        code: item.code, description: item.description, unit: item.unit, location: item.location,
        reorderPoint: item.reorderPoint, leadTimeDays: item.leadTimeDays, isTool: item.isTool,
      }
    );
    return { id: rows[0].ItemId };
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) throw new HttpError(409, 'That item code is already used.');
    throw err;
  }
}

async function updateItem(id, body) {
  const item = validateItemInput(body, { creating: false });
  const rows = await query(
    `UPDATE dbo.Item SET Description = @description, Unit = @unit, Location = @location,
       ReorderPoint = @reorderPoint, LeadTimeDays = @leadTimeDays, IsTool = @isTool, IsActive = @isActive
     OUTPUT inserted.ItemId
     WHERE ItemId = @id`,
    {
      id, description: item.description, unit: item.unit, location: item.location,
      reorderPoint: item.reorderPoint, leadTimeDays: item.leadTimeDays, isTool: item.isTool, isActive: item.isActive,
    }
  );
  if (!rows.length) throw new HttpError(404, 'Item not found.');
  return { id };
}

module.exports = { listItems, createItem, updateItem };
