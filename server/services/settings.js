// Limits and thresholds live in the Setting table, never in the code.
const db = require('../db');

function getSetting(key) {
  const row = db.get('SELECT SettingValue FROM Setting WHERE SettingKey = @key', { key });
  if (!row) throw new Error(`Setting not found: ${key}`);
  return row.SettingValue;
}

function getNumberSetting(key) {
  return Number(getSetting(key));
}

module.exports = { getSetting, getNumberSetting };
