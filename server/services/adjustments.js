// Stock count adjustments by warehouse custodian.
const db = require('../db');
const { HttpError } = require('./errors');
const { hasTwoDecimals } = require('./stockRules');
const { notifyRole } = require('./notifications');

function isId(n) {
  return Number.isInteger(n) && n > 0;
}

function readCount(value) {
  let countValue = value;
  if (typeof value === 'string' && value.trim() !== '') {
    countValue = Number(value);
  }
  if (typeof countValue !== 'number' || !Number.isFinite(countValue)) {
    throw new HttpError(400, 'Enter the counted quantity.');
  }
  if (countValue < 0 || countValue > 1000000 || !hasTwoDecimals(countValue)) {
    throw new HttpError(400, 'The counted quantity must be zero or more, with at most 2 decimals.');
  }
  return countValue;
}

function adjustStock(input) {
  const data = input || {};
  const itemId = data.itemId;
  const counted = data.counted;
  const reason = data.reason;
  const userId = data.userId;

  if (!isId(itemId)) {
    throw new HttpError(400, 'adjustStock needs the itemId.');
  }
  if (!isId(userId)) {
    throw new HttpError(400, 'adjustStock needs the userId of the custodian.');
  }
  const note = String(reason || '').trim();
  if (!note) {
    throw new HttpError(400, 'Write the reason for the adjustment.');
  }
  if (note.length > 200) {
    throw new HttpError(400, 'The reason can be up to 200 characters.');
  }
  const count = readCount(counted);

  return db.transaction(() => {
    const row = db.get('SELECT Code, OnHand, Reserved FROM Item WHERE ItemId = @itemId', { itemId });
    if (!row) {
      throw new HttpError(404, 'Item not found.');
    }
    const custodian = db.get('SELECT FullName FROM AppUser WHERE UserId = @userId', { userId });
    if (!custodian) {
      throw new HttpError(400, 'adjustStock needs the userId of an existing user.');
    }
    if (Math.round(count * 100) === Math.round(row.OnHand * 100)) {
      throw new HttpError(400, 'The counted quantity is the same as On hand, so there is nothing to adjust.');
    }
    if (count < row.Reserved) {
      const unitsLabel = row.Reserved === 1 ? 'unit is' : 'units are';
      throw new HttpError(400, `${row.Reserved} ${unitsLabel} reserved for requisitions, so the count cannot be below ${row.Reserved}.`);
    }
    const change = Math.round((count - row.OnHand) * 100) / 100;
    db.run('UPDATE Item SET OnHand = ROUND(@count, 2) WHERE ItemId = @itemId', { count, itemId });
    const { lastId } = db.run(
      `INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy, Note)
       VALUES (@itemId, 'adjustment', @change, @userId, @note)`,
      { itemId, change, userId, note }
    );
    const { OnHand } = db.get('SELECT OnHand FROM Item WHERE ItemId = @itemId', { itemId });

    notifyRole(
      'owner',
      `${row.Code} was adjusted by ${custodian.FullName}: On hand went from ${row.OnHand} to ${OnHand}. Reason: ${note}`,
      '/items.html'
    );
    return { transactionId: lastId, onHand: OnHand, change };
  });
}

module.exports = { adjustStock };
