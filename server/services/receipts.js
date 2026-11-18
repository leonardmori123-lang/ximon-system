// Inventory side of delivery (handoff 2). Delivery calls these two functions and never writes
// Item, StockTransaction, RequisitionLine or IssuanceSlip itself.
//
//   receiveStock({ itemId, quantity, sourceDocument: { type: 'RR', id, number }, projectId, userId })
//     Puts the delivered units on the shelf and logs a 'receipt'. Call it once for each received line.
//
//   allocateToRequisition({ requisitionId, lines: [{ itemId, quantity }], userId })
//     Call it once for each receiving report, after the receiveStock calls, when the PR behind the PO
//     has an RF (PurchaseRequisition.RequisitionId is not empty). It sets the received units aside for
//     that RF (up to what the RF still lacks), prepares an issuance slip, and tells the requestor
//     and the custodian.
//
// Call both inside the same db.transaction() as the receiving report, so a failed report leaves
// no stock behind.
const db = require('../db');
const { HttpError } = require('./errors');
const { planAllocation } = require('./stockRules');
const { prepareSlip } = require('./issuance');
const { notifyUser, notifyRole } = require('./notifications');

const isId = (n) => Number.isInteger(n) && n > 0;
const isQuantity = (n) => Number.isFinite(n) && n > 0 && n <= 1000000 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

function receiveStock(input) {
  const { itemId, quantity, sourceDocument, projectId, userId } = input || {};
  const doc = sourceDocument || {};
  if (!isId(itemId)) throw new HttpError(400, 'receiveStock needs the itemId.');
  if (!isQuantity(quantity)) throw new HttpError(400, 'The received quantity must be above zero, with at most 2 decimals.');
  if (!isId(userId)) throw new HttpError(400, 'receiveStock needs the userId of the person who received the goods.');
  if (!doc.type || !isId(doc.id)) throw new HttpError(400, 'receiveStock needs the receiving report: sourceDocument { type, id }.');
  if (projectId != null && !isId(projectId)) throw new HttpError(400, 'The projectId is not valid.');

  return db.transaction(() => {
    const { changes } = db.run(
      'UPDATE Item SET OnHand = ROUND(OnHand + @quantity, 2) WHERE ItemId = @itemId',
      { itemId, quantity }
    );
    if (changes === 0) throw new HttpError(404, 'Item not found.');
    const { lastId } = db.run(
      `INSERT INTO StockTransaction (ItemId, TxType, Quantity, RefDocType, RefDocId, ProjectId, CreatedBy, Note)
       VALUES (@itemId, 'receipt', @quantity, @docType, @docId, @projectId, @userId, @note)`,
      { itemId, quantity, docType: String(doc.type), docId: doc.id, projectId: projectId ?? null, userId, note: doc.number || null }
    );
    const { OnHand } = db.get('SELECT OnHand FROM Item WHERE ItemId = @itemId', { itemId });
    return { transactionId: lastId, onHand: OnHand };
  });
}

// Returns { allocated: [{ itemId, quantity }], slip: { id, slipNumber } | null }.
// slip is null when nothing was set aside, or when the RF already has an open slip. In that case the
// RF shows up in the custodian's "releasable" list as soon as the open slip is confirmed.
function allocateToRequisition(input) {
  const { requisitionId, lines, userId } = input || {};
  if (!isId(requisitionId)) throw new HttpError(400, 'allocateToRequisition needs the requisitionId.');
  if (!isId(userId)) throw new HttpError(400, 'allocateToRequisition needs the userId of the person who received the goods.');
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'List the received lines.');
  for (const line of lines) {
    if (!isId(line && line.itemId) || !isQuantity(line.quantity)) throw new HttpError(400, 'Each line needs an itemId and a quantity above zero, with at most 2 decimals.');
  }

  return db.transaction(() => {
    const rf = db.get('SELECT RfNumber, Status, RequestedBy FROM Requisition WHERE RequisitionId = @requisitionId', { requisitionId });
    if (!rf) throw new HttpError(404, 'Requisition not found.');
    const nothing = { allocated: [], slip: null };
    if (!['approved', 'partly_fulfilled'].includes(rf.Status)) return nothing; // the goods stay on the shelf as free stock

    const allocated = [];
    for (const line of lines) {
      const row = db.get(
        `SELECT l.LineId, l.QtyShort, ROUND(i.OnHand - i.Reserved, 2) AS Available
         FROM RequisitionLine l JOIN Item i ON i.ItemId = l.ItemId
         WHERE l.RequisitionId = @requisitionId AND l.ItemId = @itemId`,
        { requisitionId, itemId: line.itemId }
      );
      if (!row) continue; // not an item of this RF
      const give = planAllocation(line.quantity, row.QtyShort, row.Available);
      if (give <= 0) continue;
      db.run('UPDATE Item SET Reserved = ROUND(Reserved + @give, 2) WHERE ItemId = @itemId', { give, itemId: line.itemId });
      db.run(
        'UPDATE RequisitionLine SET QtyReserved = ROUND(QtyReserved + @give, 2), QtyShort = ROUND(QtyShort - @give, 2) WHERE LineId = @lineId',
        { give, lineId: row.LineId }
      );
      allocated.push({ itemId: line.itemId, quantity: give });
    }
    if (!allocated.length) return nothing;

    const open = db.get(
      `SELECT 1 AS ok FROM IssuanceSlip WHERE RequisitionId = @requisitionId AND Status IN ('prepared', 'released')`,
      { requisitionId }
    );
    const slip = open ? null : prepareSlip({ id: userId }, requisitionId);

    notifyUser(rf.RequestedBy, `Delivered items for ${rf.RfNumber} are set aside for you.`, `/requisition.html?id=${requisitionId}`);
    if (slip) notifyRole('custodian', `${slip.slipNumber} for ${rf.RfNumber} is ready to release.`, `/slip.html?id=${slip.id}`);
    else notifyRole('custodian', `${rf.RfNumber} has more reserved items waiting. Prepare a slip once the open one is done.`, '/slips.html');
    return { allocated, slip };
  });
}

module.exports = { receiveStock, allocateToRequisition };
