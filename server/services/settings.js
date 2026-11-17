// Limits and thresholds live in the Setting table, never in the code.
const { query } = require('../db');

async function getSetting(key) {
  const rows = await query('SELECT SettingValue FROM Setting WHERE SettingKey = @key', { key });
  if (!rows.length) throw new Error(`Setting not found: ${key}`);
  return rows[0].SettingValue;
}

async function getNumberSetting(key) {
  return Number(await getSetting(key));
}

module.exports = { getSetting, getNumberSetting };
