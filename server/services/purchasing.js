// Purchasing module: suppliers, their prices, and the purchase requisitions (PR) made from RF shortages.
// The PR itself is created in handoff.js, inside the owner's approval of the RF.
const db = require('../db');
const { HttpError } = require('./errors');
const { addDocHistory, getDocHistory } = require('./history');
const { notifyRole } = require('./notifications');
const {
  PR_STATUSES, PRICEABLE_STATUSES, validateSupplierInput, checkUnitPrice, validatePriceLines, lineTotal, prTotal,
} = require('./purchasingRules');

// ---------- Suppliers ----------

function listSuppliers() {
  return db.all(
    `SELECT s.SupplierId, s.Name, s.ContactPerson, s.Phone, s.Email, s.Address, s.PaymentTerms,
            s.LeadTimeDays, s.IsActive, COUNT(sp.SupplierPriceId) AS PriceCount
     FROM Supplier s LEFT JOIN SupplierPrice sp ON sp.SupplierId = s.SupplierId
     GROUP BY s.SupplierId ORDER BY s.IsActive DESC, s.Name`
  );
}

// One supplier with a price row for every active item (the price is null when none is saved yet).
function getSupplier(id) {
  const supplier = db.get(
    `SELECT SupplierId, Name, ContactPerson, Phone, Email, Address, PaymentTerms, LeadTimeDays, IsActive
     FROM Supplier WHERE SupplierId = @id`,
    { id }
  );
  if (!supplier) throw new HttpError(404, 'Supplier not found.');
  supplier.prices = db.all(
    `SELECT i.ItemId, i.Code, i.Description, i.Unit, sp.UnitPriceCentavos
     FROM Item i LEFT JOIN SupplierPrice sp ON sp.ItemId = i.ItemId AND sp.SupplierId = @id
     WHERE i.IsActive = 1 OR sp.SupplierPriceId IS NOT NULL
     ORDER BY i.Code`,
    { id }
  );
  return supplier;
}

// The name must be new, ignoring capital letters (the table only blocks an exact copy).
function assertNameFree(name, exceptId) {
  const taken = db.get(
    'SELECT 1 AS ok FROM Supplier WHERE lower(Name) = lower(@name) AND SupplierId <> @exceptId',
    { name, exceptId: exceptId || 0 }
  );
  if (taken) throw new HttpError(409, 'A supplier with that name already exists.');
}

function createSupplier(body) {
  const s = validateSupplierInput(body, { creating: true });
  assertNameFree(s.name);
  try {
    const { lastId } = db.run(
      `INSERT INTO Supplier (Name, ContactPerson, Phone, Email, Address, PaymentTerms, LeadTimeDays)
       VALUES (@name, @contactPerson, @phone, @email, @address, @paymentTerms, @leadTimeDays)`,
      {
        name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email,
        address: s.address, paymentTerms: s.paymentTerms, leadTimeDays: s.leadTimeDays,
      }
    );
    return { id: lastId };
  } catch (err) {
    if (db.isUniqueError(err)) throw new HttpError(409, 'A supplier with that name already exists.');
    throw err;
  }
}

function updateSupplier(id, body) {
  const s = validateSupplierInput(body, { creating: false });
  if (!db.get('SELECT 1 AS ok FROM Supplier WHERE SupplierId = @id', { id })) throw new HttpError(404, 'Supplier not found.');
  assertNameFree(s.name, id);
  try {
    db.run(
      `UPDATE Supplier SET Name = @name, ContactPerson = @contactPerson, Phone = @phone, Email = @email,
         Address = @address, PaymentTerms = @paymentTerms, LeadTimeDays = @leadTimeDays, IsActive = @isActive
       WHERE SupplierId = @id`,
      { ...s, id }
    );
    return { id };
  } catch (err) {
    if (db.isUniqueError(err)) throw new HttpError(409, 'A supplier with that name already exists.');
    throw err;
  }
}

// Saves or replaces the price of one item from one supplier.
function saveSupplierPrice(supplierId, itemId, unitPriceCentavos) {
  const price = checkUnitPrice(unitPriceCentavos);
  if (!db.get('SELECT 1 AS ok FROM Supplier WHERE SupplierId = @supplierId', { supplierId })) throw new HttpError(404, 'Supplier not found.');
  if (!db.get('SELECT 1 AS ok FROM Item WHERE ItemId = @itemId', { itemId })) throw new HttpError(404, 'Item not found.');
  db.run(
    `INSERT INTO SupplierPrice (SupplierId, ItemId, UnitPriceCentavos) VALUES (@supplierId, @itemId, @price)
     ON CONFLICT (SupplierId, ItemId) DO UPDATE SET UnitPriceCentavos = @price, UpdatedAt = datetime('now','localtime')`,
    { supplierId, itemId, price }
  );
  return { supplierId, itemId, unitPriceCentavos: price };
}

// ---------- Purchase requisitions ----------

const prLink = (id) => `/pr.html?id=${id}`;

// The RF number comes from a join, so the purchaser never needs the RF routes (those are closed to the purchaser).
function listPrs(status) {
  if (status && !PR_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  return db.all(
    `SELECT pr.PurchaseRequisitionId, pr.PrNumber, pr.Status, r.RfNumber,
            p.Code AS ProjectCode, p.Name AS ProjectName, substr(pr.CreatedAt, 1, 16) AS CreatedAt,
            COUNT(l.PrLineId) AS LineCount, COUNT(l.UnitPriceCentavos) AS PricedCount,
            MAX(s.Name) AS SupplierName,
            CASE WHEN COUNT(l.PrLineId) > 0 AND COUNT(l.UnitPriceCentavos) = COUNT(l.PrLineId)
                 THEN SUM(CAST(ROUND(l.ShortQty * l.UnitPriceCentavos) AS INTEGER)) END AS TotalCentavos
     FROM PurchaseRequisition pr
     JOIN Project p ON p.ProjectId = pr.ProjectId
     LEFT JOIN Requisition r ON r.RequisitionId = pr.RequisitionId
     LEFT JOIN PRLine l ON l.PurchaseRequisitionId = pr.PurchaseRequisitionId
     LEFT JOIN Supplier s ON s.SupplierId = l.SupplierId
     ${status ? 'WHERE pr.Status = @status' : ''}
     GROUP BY pr.PurchaseRequisitionId ORDER BY pr.PurchaseRequisitionId DESC`,
    status ? { status } : {}
  );
}

function getPr(user, id) {
  const pr = db.get(
    `SELECT pr.PurchaseRequisitionId, pr.PrNumber, pr.Status, pr.Reason, pr.OverBudget, pr.OwnerNote,
            pr.RequisitionId, r.RfNumber, pr.ProjectId, p.Code AS ProjectCode, p.Name AS ProjectName,
            d.FullName AS DecidedByName, substr(pr.DecidedAt, 1, 16) AS DecidedAt,
            substr(pr.CreatedAt, 1, 16) AS CreatedAt
     FROM PurchaseRequisition pr
     JOIN Project p ON p.ProjectId = pr.ProjectId
     LEFT JOIN Requisition r ON r.RequisitionId = pr.RequisitionId
     LEFT JOIN AppUser d ON d.UserId = pr.DecidedBy
     WHERE pr.PurchaseRequisitionId = @id`,
    { id }
  );
  if (!pr) throw new HttpError(404, 'Purchase requisition not found.');

  const lines = db.all(
    `SELECT l.PrLineId, l.ItemId, i.Code, i.Description, i.Unit, l.ShortQty,
            l.SupplierId, s.Name AS SupplierName, l.UnitPriceCentavos
     FROM PRLine l
     JOIN Item i ON i.ItemId = l.ItemId
     LEFT JOIN Supplier s ON s.SupplierId = l.SupplierId
     WHERE l.PurchaseRequisitionId = @id ORDER BY l.PrLineId`,
    { id }
  );
  for (const line of lines) {
    line.LineTotalCentavos = line.UnitPriceCentavos == null ? null : lineTotal(line.ShortQty, line.UnitPriceCentavos);
  }

  // One supplier for the whole PR: the save below sets the same supplier on every line.
  const supplierLine = lines.find((l) => l.SupplierId != null);
  return {
    ...pr,
    SupplierId: supplierLine ? supplierLine.SupplierId : null,
    SupplierName: supplierLine ? supplierLine.SupplierName : null,
    TotalCentavos: prTotal(lines),
    lines,
    history: getDocHistory('PR', id),
    canPrice: user.role === 'purchaser' && PRICEABLE_STATUSES.includes(pr.Status),
  };
}

// The purchaser picks one supplier for the whole PR and a unit price for each line.
// body: { supplierId, lines: [{ prLineId, unitPriceCentavos }] }
// A pending PR stays pending. A held PR goes back to pending, so the owner decides again.
function savePrices(user, id, body) {
  const input = body || {};
  const supplierId = Number(input.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) throw new HttpError(400, 'Choose a supplier.');

  return db.transaction(() => {
    const pr = db.get('SELECT PrNumber, Status FROM PurchaseRequisition WHERE PurchaseRequisitionId = @id', { id });
    if (!pr) throw new HttpError(404, 'Purchase requisition not found.');
    if (!PRICEABLE_STATUSES.includes(pr.Status)) {
      throw new HttpError(409, `This purchase requisition is ${pr.Status.replace('_', ' ')}, so its prices cannot be changed.`);
    }
    if (!db.get('SELECT 1 AS ok FROM Supplier WHERE SupplierId = @supplierId AND IsActive = 1', { supplierId })) {
      throw new HttpError(400, 'That supplier is not available.');
    }
    const prLineIds = db.all('SELECT PrLineId FROM PRLine WHERE PurchaseRequisitionId = @id', { id }).map((l) => l.PrLineId);
    const prices = validatePriceLines(input.lines, prLineIds);

    for (const line of prices) {
      db.run(
        `UPDATE PRLine SET SupplierId = @supplierId, UnitPriceCentavos = @price
         WHERE PrLineId = @prLineId AND PurchaseRequisitionId = @id`,
        { supplierId, price: line.unitPriceCentavos, prLineId: line.prLineId, id }
      );
    }

    // Resubmitting a held PR clears the hold, so the owner sees a clean pending PR.
    const wasHeld = pr.Status === 'on_hold';
    if (wasHeld) {
      const { changes } = db.run(
        `UPDATE PurchaseRequisition
         SET Status = 'pending', Reason = NULL, DecidedBy = NULL, DecidedAt = NULL, UpdatedAt = datetime('now','localtime')
         WHERE PurchaseRequisitionId = @id AND Status = 'on_hold'`,
        { id }
      );
      if (changes === 0) throw new HttpError(409, 'This purchase requisition changed. Open it again.');
      addDocHistory('PR', id, 'on_hold', 'pending', user.id, 'Revised and resubmitted');
    } else {
      db.run(`UPDATE PurchaseRequisition SET UpdatedAt = datetime('now','localtime') WHERE PurchaseRequisitionId = @id`, { id });
    }

    notifyRole('owner', wasHeld
      ? `${pr.PrNumber} was revised and needs your decision again.`
      : `${pr.PrNumber} has a supplier and prices and needs your approval.`, prLink(id));
    return { id, status: 'pending' };
  });
}

module.exports = {
  listSuppliers, getSupplier, createSupplier, updateSupplier, saveSupplierPrice,
  listPrs, getPr, savePrices,
};
