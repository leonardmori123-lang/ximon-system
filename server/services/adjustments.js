// Stock adjustment: the custodian fixes a wrong count.
// He types what he counted (not the difference). The server works out the difference, saves the new
// On hand, and logs it in StockTransaction as an 'adjustment' with the reason as the note.
//   Quantity in the log = counted minus the On hand before. Negative when stock goes down, the same
//   way issue rows are negative, so the log still adds up to On hand.
// The On hand update, the log row and the owner's notification happen in one transaction, so a
// refused or failed adjustment changes nothing and sends nothing.
const db = require('../db');
const { HttpError } = require('./errors');
const { hasTwoDecimals } = require('./stockRules');
const { notifyRole } = require('./notifications');

const isId = (n) => Number.isInteger(n) && n > 0;

// Accepts a number (8, 2.5) or text that is a number ("8"). Anything else, including empty text, is refused.
function readCount(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'Enter the counted quantity.');
  if (n < 0 || n > 1000000 || !hasTwoDecimals(n)) {
    throw new HttpError(400, 'The counted quantity must be zero or more, with at most 2 decimals.');
  }
  return n;
}

function adjustStock(input) {
  const { itemId, counted, reason, userId } = input || {};
  if (!isId(itemId)) throw new HttpError(400, 'adjustStock needs the itemId.');
  if (!isId(userId)) throw new HttpError(400, 'adjustStock needs the userId of the custodian.');
  const note = String(reason || '').trim();
  if (!note) throw new HttpError(400, 'Write the reason for the adjustment.');
  if (note.length > 200) throw new HttpError(400, 'The reason can be up to 200 characters.');
  const count = readCount(counted);

  return db.transaction(() => {
    const row = db.get('SELECT Code, OnHand, Reserved FROM Item WHERE ItemId = @itemId', { itemId });
    if (!row) throw new HttpError(404, 'Item not found.');
    const custodian = db.get('SELECT FullName FROM AppUser WHERE UserId = @userId', { userId });
    if (!custodian) throw new HttpError(400, 'adjustStock needs the userId of an existing user.');
    if (Math.round(count * 100) === Math.round(row.OnHand * 100)) {
      throw new HttpError(400, 'The counted quantity is the same as On hand, so there is nothing to adjust.');
    }
    if (count < row.Reserved) {
      throw new HttpError(400, `${row.Reserved} ${row.Reserved === 1 ? 'unit is' : 'units are'} reserved for requisitions, so the count cannot be below ${row.Reserved}.`);
    }
    const change = Math.round((count - row.OnHand) * 100) / 100;
    db.run('UPDATE Item SET OnHand = ROUND(@count, 2) WHERE ItemId = @itemId', { count, itemId });
    const { lastId } = db.run(
      `INSERT INTO StockTransaction (ItemId, TxType, Quantity, CreatedBy, Note)
       VALUES (@itemId, 'adjustment', @change, @userId, @note)`,
      { itemId, change, userId, note }
    );
    const { OnHand } = db.get('SELECT OnHand FROM Item WHERE ItemId = @itemId', { itemId });

    // The proposal says count differences are flagged for the owner.
    notifyRole('owner',
      `${row.Code} was adjusted by ${custodian.FullName}: On hand went from ${row.OnHand} to ${OnHand}. Reason: ${note}`,
      '/items.html');
    return { transactionId: lastId, onHand: OnHand, change };
  });
}

module.exports = { adjustStock };
