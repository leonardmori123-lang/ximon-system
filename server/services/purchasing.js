// Purchasing module: suppliers, their prices, the purchase requisitions (PR) made from RF shortages,
// and the purchase orders (PO) made from approved PRs.
// The PR itself is created in handoff.js, inside the owner's approval of the RF.
const db = require('../db');
const { HttpError } = require('./errors');
const { addDocHistory, getDocHistory } = require('./history');
const { nextNumber } = require('./numbering');
const { notifyUser, notifyRole } = require('./notifications');
const {
  PR_STATUSES, PO_STATUSES, PRICEABLE_STATUSES, DECISIONS, validateSupplierInput, checkUnitPrice, validatePriceLines, lineTotal, prTotal,
  budgetCheck, checkReason, checkOwnerNote, formatPesos, MAX_REASON_LENGTH, ownerDecisions, validatePoInput, defaultDeliveryDate, poTotals,
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

// A PR the owner still has to decide on. Only these get a live budget check.
const OPEN_FOR_DECISION = ['pending', 'on_hold'];

// What a project's budget is already promised to: every PO made for the project, delivered or not, and
// every approved PR that has no PO yet. A PR still waiting for the owner is not counted, so the PR being
// checked never counts itself.
function committedCentavos(projectId) {
  const pos = db.get('SELECT COALESCE(SUM(TotalCentavos), 0) AS total FROM PurchaseOrder WHERE ProjectId = @projectId', { projectId }).total;
  const waiting = db.all(
    `SELECT l.ShortQty, l.UnitPriceCentavos
     FROM PRLine l JOIN PurchaseRequisition pr ON pr.PurchaseRequisitionId = l.PurchaseRequisitionId
     WHERE pr.ProjectId = @projectId AND pr.Status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM PurchaseOrder po WHERE po.PurchaseRequisitionId = pr.PurchaseRequisitionId)`,
    { projectId }
  );
  return pos + waiting.reduce((sum, l) => sum + (l.UnitPriceCentavos == null ? 0 : lineTotal(l.ShortQty, l.UnitPriceCentavos)), 0);
}

// The budget check for a PR of this project, with its total as the PR stands now.
function projectBudgetCheck(projectId, prTotalCentavos) {
  const project = db.get('SELECT MaterialBudgetCentavos AS budget FROM Project WHERE ProjectId = @projectId', { projectId });
  return budgetCheck(project.budget, committedCentavos(projectId), prTotalCentavos);
}

// The RF number comes from a join, so the purchaser never needs the RF routes (those are closed to the purchaser).
function listPrs(status) {
  if (status && !PR_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  const rows = db.all(
    `SELECT pr.PurchaseRequisitionId, pr.PrNumber, pr.Status, pr.OverBudget, r.RfNumber, pr.ProjectId,
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
  // OverBudget: live for a PR still waiting for the owner, as saved for one he already decided.
  return rows.map((row) => ({
    ...row,
    OverBudget: OPEN_FOR_DECISION.includes(row.Status) && row.TotalCentavos != null
      ? projectBudgetCheck(row.ProjectId, row.TotalCentavos).overBudget
      : row.OverBudget === 1,
  }));
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
  const total = prTotal(lines); // null while any line has no price

  // The budget check, while the owner still has to decide and every line is priced.
  const budget = OPEN_FOR_DECISION.includes(pr.Status) && total !== null ? projectBudgetCheck(pr.ProjectId, total) : null;

  // The PO made from this PR, if any. Both roles may see the link to it.
  const po = db.get('SELECT PurchaseOrderId, PoNumber, Status FROM PurchaseOrder WHERE PurchaseRequisitionId = @id', { id });
  // The purchaser can make the PO when the PR is approved, fully priced and has none yet.
  const canMakePo = user.role === 'purchaser' && pr.Status === 'approved' && !po && total !== null && !!supplierLine;
  let poDefaults = null;
  if (canMakePo) {
    // What the PO form starts with. The same fallbacks createPo uses for a box left empty.
    const supplier = db.get('SELECT PaymentTerms, LeadTimeDays FROM Supplier WHERE SupplierId = @id', { id: supplierLine.SupplierId });
    poDefaults = {
      discountPercent: 0,
      paymentTerms: supplier.PaymentTerms || '',
      expectedDeliveryDate: defaultDeliveryDate(supplier.LeadTimeDays),
      deliveryPoint: `${pr.ProjectCode}, ${pr.ProjectName}`,
    };
  }

  return {
    ...pr,
    SupplierId: supplierLine ? supplierLine.SupplierId : null,
    SupplierName: supplierLine ? supplierLine.SupplierName : null,
    TotalCentavos: total,
    budget,
    lines,
    history: getDocHistory('PR', id),
    po: po ? { ...po } : null,
    canMakePo,
    poDefaults,
    canPrice: user.role === 'purchaser' && PRICEABLE_STATUSES.includes(pr.Status),
    // The buttons the owner may press now: some of 'approve', 'hold', 'cancel'. Nobody else gets any.
    decisions: user.role === 'owner' ? ownerDecisions(pr.Status, total !== null) : [],
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
    const pr = db.get('SELECT PrNumber, Status, ProjectId FROM PurchaseRequisition WHERE PurchaseRequisitionId = @id', { id });
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

    const saved = db.all('SELECT ShortQty, UnitPriceCentavos FROM PRLine WHERE PurchaseRequisitionId = @id', { id });
    const overBudget = projectBudgetCheck(pr.ProjectId, prTotal(saved)).overBudget;
    notifyRole('owner', (wasHeld
      ? `${pr.PrNumber} was revised and needs your decision again.`
      : `${pr.PrNumber} has a supplier and prices and needs your approval.`) + (overBudget ? ' It is over the project budget.' : ''), prLink(id));
    return { id, status: 'pending' };
  });
}

// ---------- The owner's decision ----------

// action is 'approve', 'hold' or 'cancel'. Hold and cancel need body.reason.
// Approve and hold work on a pending PR, cancel on a pending or a held one. Approve also needs a
// supplier and a price on every line. A held PR comes back through savePrices above.
// The foreman who asked for the RF is told the result, without the reason and without any money.
function decidePr(user, id, action, body) {
  const rule = DECISIONS[action];
  const reason = rule.needsReason ? checkReason((body || {}).reason, action) : null;
  // The owner's note belongs to an approval. It is required when the PR is over the project budget.
  const note = action === 'approve' ? checkOwnerNote((body || {}).note) : null;

  return db.transaction(() => {
    const pr = db.get(
      `SELECT pr.PrNumber, pr.Status, pr.ProjectId, pr.RequisitionId, r.RfNumber, r.RequestedBy
       FROM PurchaseRequisition pr LEFT JOIN Requisition r ON r.RequisitionId = pr.RequisitionId
       WHERE pr.PurchaseRequisitionId = @id`,
      { id }
    );
    if (!pr) throw new HttpError(404, 'Purchase requisition not found.');
    if (!rule.from.includes(pr.Status)) {
      throw new HttpError(409, `This purchase requisition is ${pr.Status.replace('_', ' ')}, so it cannot be ${rule.done}.`);
    }
    let overBudget = false;
    if (action === 'approve') {
      const count = db.get(
        'SELECT COUNT(*) AS lines, COUNT(UnitPriceCentavos) AS priced FROM PRLine WHERE PurchaseRequisitionId = @id',
        { id }
      );
      if (count.lines === 0 || count.priced < count.lines) {
        throw new HttpError(409, 'The purchaser has not saved a supplier and a price for every line yet, so it cannot be approved.');
      }
      // Over budget is judged now, as the PR is approved, and saved with the PR.
      const lines = db.all('SELECT ShortQty, UnitPriceCentavos FROM PRLine WHERE PurchaseRequisitionId = @id', { id });
      const budget = projectBudgetCheck(pr.ProjectId, prTotal(lines));
      overBudget = budget.overBudget;
      if (overBudget && !note) {
        throw new HttpError(400, `This purchase requisition is over the project budget by PHP ${formatPesos(budget.overByCentavos)}. Write why you are approving it, up to ${MAX_REASON_LENGTH} characters.`);
      }
    }

    const { changes } = db.run(
      `UPDATE PurchaseRequisition
       SET Status = @to, Reason = @reason, OverBudget = @overBudget, OwnerNote = @note, DecidedBy = @userId,
           DecidedAt = datetime('now','localtime'), UpdatedAt = datetime('now','localtime')
       WHERE PurchaseRequisitionId = @id AND Status = @from`,
      { to: rule.to, reason, overBudget: overBudget ? 1 : 0, note, userId: user.id, id, from: pr.Status }
    );
    if (changes === 0) throw new HttpError(409, 'This purchase requisition changed. Open it again.');
    addDocHistory('PR', id, pr.Status, rule.to, user.id, reason || note);

    // The purchasers hear the reason. The requestor hears only the outcome, on the RF page (the foreman cannot open the PR page).
    const outcome = { approve: overBudget ? 'was approved over the project budget.' : 'was approved.', hold: `was put on hold: ${reason}`, cancel: `was cancelled: ${reason}` }[action];
    notifyRole('purchaser', `${pr.PrNumber} ${outcome}`, prLink(id));
    if (pr.RequestedBy) {
      notifyUser(pr.RequestedBy, `${pr.PrNumber} for ${pr.RfNumber} was ${rule.done}.`, `/requisition.html?id=${pr.RequisitionId}`);
    }
    return { id, status: rule.to };
  });
}

// ---------- The purchase order ----------

// The purchaser turns an approved PR into a numbered PO. One PO per PR.
// body: { discountPercent, deliveryPoint, expectedDeliveryDate, paymentTerms }, all optional:
//   discount 0; delivery point the project; expected date today plus the supplier's lead time; terms the supplier's.
// The PO copies the supplier, the quantities and the prices from the PR. PurchaseRequisitionId is always set,
// because the RF's Document Trail finds the PO through it.
function createPo(user, prId, body) {
  const input = validatePoInput(body);

  return db.transaction(() => {
    const pr = db.get(
      `SELECT pr.Status, pr.ProjectId, p.Code AS ProjectCode, p.Name AS ProjectName
       FROM PurchaseRequisition pr JOIN Project p ON p.ProjectId = pr.ProjectId
       WHERE pr.PurchaseRequisitionId = @prId`,
      { prId }
    );
    if (!pr) throw new HttpError(404, 'Purchase requisition not found.');
    if (pr.Status !== 'approved') {
      throw new HttpError(409, `This purchase requisition is ${pr.Status.replace('_', ' ')}, so it cannot become a purchase order. Only an approved one can.`);
    }
    const existing = db.get('SELECT PoNumber FROM PurchaseOrder WHERE PurchaseRequisitionId = @prId', { prId });
    if (existing) throw new HttpError(409, `This purchase requisition already has a purchase order (${existing.PoNumber}).`);

    const lines = db.all(
      `SELECT PrLineId, ItemId, ShortQty, SupplierId, UnitPriceCentavos
       FROM PRLine WHERE PurchaseRequisitionId = @prId ORDER BY PrLineId`,
      { prId }
    );
    const supplierIds = new Set(lines.map((l) => l.SupplierId));
    if (lines.length === 0 || lines.some((l) => l.UnitPriceCentavos == null) || supplierIds.size !== 1) {
      throw new HttpError(409, 'Every line needs the same supplier and a price before a purchase order can be made.');
    }
    const supplier = db.get('SELECT SupplierId, PaymentTerms, LeadTimeDays FROM Supplier WHERE SupplierId = @id', { id: lines[0].SupplierId });

    const lineTotals = lines.map((l) => lineTotal(l.ShortQty, l.UnitPriceCentavos));
    const { subtotalCentavos, discountCentavos, totalCentavos } = poTotals(lineTotals, input.discountPercent);

    const poNumber = nextNumber('PO');
    const { lastId: poId } = db.run(
      `INSERT INTO PurchaseOrder (PoNumber, PurchaseRequisitionId, SupplierId, ProjectId, PaymentTerms, ExpectedDeliveryDate,
                                  DeliveryPoint, DiscountPercent, SubtotalCentavos, DiscountCentavos, TotalCentavos, CreatedBy)
       VALUES (@poNumber, @prId, @supplierId, @projectId, @paymentTerms, @expectedDate,
               @deliveryPoint, @discountPercent, @subtotal, @discount, @total, @userId)`,
      {
        poNumber, prId, supplierId: supplier.SupplierId, projectId: pr.ProjectId,
        paymentTerms: input.paymentTerms || supplier.PaymentTerms,
        expectedDate: input.expectedDeliveryDate || defaultDeliveryDate(supplier.LeadTimeDays),
        deliveryPoint: input.deliveryPoint || `${pr.ProjectCode}, ${pr.ProjectName}`,
        discountPercent: input.discountPercent,
        subtotal: subtotalCentavos, discount: discountCentavos, total: totalCentavos, userId: user.id,
      }
    );
    lines.forEach((line, i) => {
      db.run(
        `INSERT INTO POLine (PurchaseOrderId, PrLineId, ItemId, Quantity, UnitPriceCentavos, LineTotalCentavos)
         VALUES (@poId, @prLineId, @itemId, @quantity, @price, @lineTotal)`,
        { poId, prLineId: line.PrLineId, itemId: line.ItemId, quantity: line.ShortQty, price: line.UnitPriceCentavos, lineTotal: lineTotals[i] }
      );
    });
    addDocHistory('PO', poId, null, 'open', user.id, null);
    return { id: poId, poNumber, status: 'open', subtotalCentavos, discountCentavos, totalCentavos };
  });
}

// The delivery verifier checks a delivery against a PO: supplier, items, quantities, dates. No prices, discounts
// or totals are sent to this role, the same way the foreman never gets money.
const isMoneyField = (name) => /Centavos$/.test(name) || name === 'DiscountPercent';
function withoutMoney(row) {
  return Object.fromEntries(Object.entries(row).filter(([name]) => !isMoneyField(name)));
}

// All purchase orders, newest first. status is optional: open, partly_delivered or closed.
// The user decides whether money is included (the verifier does not get it).
function listPos(user, status) {
  if (status && !PO_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  const rows = db.all(
    `SELECT po.PurchaseOrderId, po.PoNumber, po.Status, s.Name AS SupplierName, p.Code AS ProjectCode,
            po.PurchaseRequisitionId, pr.PrNumber, po.ExpectedDeliveryDate, po.TotalCentavos, substr(po.CreatedAt, 1, 16) AS CreatedAt
     FROM PurchaseOrder po
     JOIN Supplier s ON s.SupplierId = po.SupplierId
     JOIN Project p ON p.ProjectId = po.ProjectId
     LEFT JOIN PurchaseRequisition pr ON pr.PurchaseRequisitionId = po.PurchaseRequisitionId
     ${status ? 'WHERE po.Status = @status' : ''}
     ORDER BY po.PurchaseOrderId DESC`,
    status ? { status } : {}
  );
  return user.role === 'verifier' ? rows.map(withoutMoney) : rows;
}

// One purchase order with its supplier, lines, totals and history. The print page uses the same data.
// The verifier gets it without any money.
function getPo(user, id) {
  const po = db.get(
    `SELECT po.PurchaseOrderId, po.PoNumber, po.Status, po.PurchaseRequisitionId, pr.PrNumber,
            po.SupplierId, s.Name AS SupplierName, s.ContactPerson AS SupplierContact, s.Phone AS SupplierPhone,
            s.Email AS SupplierEmail, s.Address AS SupplierAddress,
            po.ProjectId, p.Code AS ProjectCode, p.Name AS ProjectName,
            po.PaymentTerms, po.ExpectedDeliveryDate, po.DeliveryPoint, po.DiscountPercent, po.OtherDiscountCentavos,
            po.ShippingCentavos, po.SubtotalCentavos, po.DiscountCentavos, po.TotalCentavos,
            u.FullName AS CreatedByName, substr(po.CreatedAt, 1, 16) AS CreatedAt
     FROM PurchaseOrder po
     JOIN Supplier s ON s.SupplierId = po.SupplierId
     JOIN Project p ON p.ProjectId = po.ProjectId
     JOIN AppUser u ON u.UserId = po.CreatedBy
     LEFT JOIN PurchaseRequisition pr ON pr.PurchaseRequisitionId = po.PurchaseRequisitionId
     WHERE po.PurchaseOrderId = @id`,
    { id }
  );
  if (!po) throw new HttpError(404, 'Purchase order not found.');

  const lines = db.all(
    `SELECT l.PoLineId, l.ItemId, i.Code, i.Description, i.Unit, l.Quantity, l.UnitPriceCentavos,
            l.LineTotalCentavos, l.QtyReceived
     FROM POLine l JOIN Item i ON i.ItemId = l.ItemId
     WHERE l.PurchaseOrderId = @id ORDER BY l.PoLineId`,
    { id }
  );
  const whole = { ...po, lines, history: getDocHistory('PO', id) };
  if (user.role !== 'verifier') return whole;
  return { ...withoutMoney(po), lines: lines.map(withoutMoney), history: whole.history };
}

module.exports = {
  listSuppliers, getSupplier, createSupplier, updateSupplier, saveSupplierPrice,
  listPrs, getPr, savePrices, decidePr, createPo, listPos, getPo,
};
