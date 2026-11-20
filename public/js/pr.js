const content = document.getElementById('content');
const errorBox = document.getElementById('error');
const id = new URLSearchParams(location.search).get('id');
let user;
let flash = ''; // a short "Saved" line shown once after the page reloads

function info(pr) {
  // The purchaser cannot open RF pages, so the RF number is plain text for them.
  const rfCell = !pr.RfNumber ? 'None'
    : user.role === 'owner' ? h('a', { href: `/requisition.html?id=${pr.RequisitionId}` }, pr.RfNumber)
      : pr.RfNumber;
  const pairs = [
    ['Requisition form', rfCell],
    ['Project', `${pr.ProjectCode}, ${pr.ProjectName}`],
    ['Created', pr.CreatedAt],
    ['Supplier', pr.SupplierName || 'Not chosen yet'],
  ];
  if (pr.Status === 'on_hold' && pr.Reason) pairs.push(['Hold reason', pr.Reason]);
  if (pr.Status === 'cancelled' && pr.Reason) pairs.push(['Cancel reason', pr.Reason]);
  if (pr.DecidedByName) pairs.push(['Decided by', `${pr.DecidedByName}, ${pr.DecidedAt}`]);
  return h('dl', { class: 'info-grid' }, pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

// The lines as saved. The owner always sees this one; the purchaser sees it once the PR is decided.
function linesTable(pr) {
  return h('div', { class: 'panel table-responsive mt-4' },
    h('table', { class: 'table mb-0' },
      h('thead', null, h('tr', null,
        h('th', null, 'Code'), h('th', null, 'Description'), h('th', null, 'Unit'),
        h('th', { class: 'num' }, 'Short quantity'), h('th', { class: 'num' }, 'Unit price (PHP)'), h('th', { class: 'num' }, 'Line total (PHP)'))),
      h('tbody', null,
        pr.lines.map((l) => h('tr', null,
          h('td', { class: 'text-nowrap' }, l.Code), h('td', null, l.Description), h('td', null, l.Unit),
          h('td', { class: 'num' }, qty(l.ShortQty)),
          h('td', { class: 'num' }, l.UnitPriceCentavos == null ? 'Not priced' : pesos(l.UnitPriceCentavos)),
          h('td', { class: 'num' }, l.LineTotalCentavos == null ? '' : pesos(l.LineTotalCentavos)))),
        h('tr', null,
          h('th', { colSpan: 5, class: 'text-end' }, 'Total'),
          h('th', { class: 'num' }, pr.TotalCentavos == null ? '' : pesos(pr.TotalCentavos))))));
}

// The purchaser picks one supplier for the whole PR and types a unit price for each line.
function pricingForm(pr, suppliers) {
  const select = h('select', { class: 'form-select', id: 'supplier', style: 'max-width: 24rem;' },
    h('option', { value: '' }, 'Choose a supplier'),
    ...suppliers.filter((s) => s.IsActive).map((s) => h('option', { value: s.SupplierId }, s.Name)));
  select.value = pr.SupplierId && suppliers.some((s) => s.IsActive && s.SupplierId === pr.SupplierId) ? String(pr.SupplierId) : '';

  const totalCell = h('th', { class: 'num' });
  const inputs = pr.lines.map((l) => h('input', {
    class: 'form-control form-control-sm num', inputMode: 'decimal', autocomplete: 'off',
    value: l.UnitPriceCentavos == null ? '' : pesosPlain(l.UnitPriceCentavos),
    'aria-label': `Unit price of ${l.Code}`, style: 'max-width: 10rem; margin-left: auto;',
  }));
  const lineCells = pr.lines.map(() => h('td', { class: 'num' }));
  const formError = h('p', { class: 'status-bad small mt-3 mb-0', role: 'alert', hidden: true });
  const fillNote = h('p', { class: 'hint mt-2 mb-0' });

  function recalc() {
    let total = 0;
    let complete = true;
    pr.lines.forEach((l, i) => {
      const centavos = toCentavos(inputs[i].value);
      if (centavos === null) { lineCells[i].textContent = ''; complete = false; return; }
      const lineTotal = Math.round(Number(l.ShortQty) * centavos);
      lineCells[i].textContent = pesos(lineTotal);
      total += lineTotal;
    });
    totalCell.textContent = complete ? pesos(total) : '';
  }
  inputs.forEach((input) => input.addEventListener('input', () => { showError(formError, ''); recalc(); }));

  // A new supplier fills the boxes from that supplier's saved prices; empty where it has none.
  select.addEventListener('change', async () => {
    showError(formError, '');
    fillNote.textContent = '';
    if (!select.value) return;
    try {
      const supplier = await api(`/api/purchasing/suppliers/${encodeURIComponent(select.value)}`);
      const byItem = new Map(supplier.prices.map((p) => [p.ItemId, p.UnitPriceCentavos]));
      pr.lines.forEach((l, i) => {
        const saved = byItem.get(l.ItemId);
        inputs[i].value = saved == null ? '' : pesosPlain(saved);
      });
      const missing = pr.lines.filter((l) => byItem.get(l.ItemId) == null).length;
      fillNote.textContent = missing === 0
        ? 'Prices filled from the supplier\'s list. Change any of them if the supplier quoted something else.'
        : `${missing === 1 ? '1 line has' : `${missing} lines have`} no saved price from this supplier. Type ${missing === 1 ? 'it' : 'them'} in.`;
      recalc();
    } catch (err) {
      showError(errorBox, err.message);
    }
  });

  async function save() {
    showError(formError, '');
    showError(errorBox, '');
    if (!select.value) { showError(formError, 'Choose a supplier.'); return; }
    const lines = [];
    for (let i = 0; i < pr.lines.length; i += 1) {
      const centavos = toCentavos(inputs[i].value);
      if (centavos === null) { showError(formError, `${pr.lines[i].Code}: ${PRICE_ERROR}`); return; }
      lines.push({ prLineId: pr.lines[i].PrLineId, unitPriceCentavos: centavos });
    }
    try {
      await api(`/api/purchasing/prs/${id}/prices`, { method: 'PUT', body: { supplierId: Number(select.value), lines } });
      flash = 'Saved. The owner has been notified.';
      await load();
    } catch (err) {
      showError(formError, err.message);
    }
  }

  const intro = pr.Status === 'on_hold'
    ? 'The owner put this on hold. Change the supplier or the prices and save to send it back for approval.'
    : pr.SupplierId
      ? 'Prices are saved. You can still change the supplier or the prices until the owner decides.'
      : 'Choose a supplier and enter a unit price for every line. The owner is notified when you save.';

  recalc();
  return h('div', { class: 'panel p-3 mt-4' },
    h('h2', { class: 'h6' }, 'Supplier and prices'),
    h('p', { class: 'hint' }, intro),
    h('label', { class: 'form-label', htmlFor: 'supplier' }, 'Supplier'),
    select,
    suppliers.some((s) => s.IsActive) ? null : h('p', { class: 'hint mt-2 mb-0' }, 'No active supplier yet. ', h('a', { href: '/suppliers.html' }, 'Add one first.')),
    fillNote,
    h('div', { class: 'table-responsive mt-3' },
      h('table', { class: 'table mb-0 align-middle' },
        h('thead', null, h('tr', null,
          h('th', null, 'Code'), h('th', null, 'Description'), h('th', null, 'Unit'),
          h('th', { class: 'num' }, 'Short quantity'), h('th', { class: 'num' }, 'Unit price (PHP)'), h('th', { class: 'num' }, 'Line total (PHP)'))),
        h('tbody', null,
          pr.lines.map((l, i) => h('tr', null,
            h('td', { class: 'text-nowrap' }, l.Code), h('td', null, l.Description), h('td', null, l.Unit),
            h('td', { class: 'num' }, qty(l.ShortQty)), h('td', null, inputs[i]), lineCells[i])),
          h('tr', null, h('th', { colSpan: 5, class: 'text-end' }, 'Total'), totalCell)))),
    formError,
    h('button', { class: 'btn btn-ximon mt-3', type: 'button', onclick: save },
      pr.Status === 'on_hold' ? 'Save and send back for approval' : 'Save prices'));
}

// The owner's decision. Approving needs no reason; putting on hold and cancelling do.
// pr.decisions lists the buttons that make sense for this status, so the server and the screen agree.
function decisionPanel(pr) {
  if (!pr.decisions || pr.decisions.length === 0) return null;
  const can = (action) => pr.decisions.includes(action);
  const reason = h('textarea', {
    class: 'form-control', id: 'decision-reason', rows: 2, maxLength: 300,
    placeholder: 'Reason, required to put on hold or cancel',
  });
  const formError = h('p', { class: 'status-bad small mt-3 mb-0', role: 'alert', hidden: true });

  async function decide(action, { reasonNeeded, confirmText, done }) {
    showError(formError, '');
    showError(errorBox, '');
    const text = reason.value.trim();
    if (reasonNeeded && !text) { showError(formError, 'Write the reason first.'); return; }
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api(`/api/purchasing/prs/${id}/${action}`, { method: 'POST', body: reasonNeeded ? { reason: text } : {} });
      flash = done;
      await load();
    } catch (err) {
      showError(formError, err.message);
    }
  }

  let intro = 'Check the supplier, the prices and the total, then decide.';
  if (pr.Status === 'on_hold') {
    intro = 'This purchase requisition is on hold. The purchaser can revise it and send it back for approval, or you can cancel it.';
  } else if (!can('approve')) {
    intro = 'The purchaser has not saved a supplier and prices yet, so it cannot be approved. You can still put it on hold or cancel it.';
  }

  return h('div', { class: 'panel p-3 mt-4' },
    h('h2', { class: 'h6' }, 'Your decision'),
    h('p', { class: 'hint' }, intro),
    can('approve') ? h('div', { class: 'mb-3' },
      h('button', {
        class: 'btn btn-success', type: 'button',
        onclick: () => decide('approve', {
          confirmText: `Approve ${pr.PrNumber}? The total is PHP ${pesos(pr.TotalCentavos)}.`,
          done: 'Approved. The purchaser has been notified.',
        }),
      }, 'Approve')) : null,
    h('label', { class: 'form-label', htmlFor: 'decision-reason' }, 'Reason'),
    reason,
    h('div', { class: 'd-flex flex-wrap gap-2 mt-2' },
      can('hold') ? h('button', {
        class: 'btn btn-outline-secondary', type: 'button',
        onclick: () => decide('hold', { reasonNeeded: true, done: 'Put on hold. The purchaser has been notified.' }),
      }, 'Put on hold') : null,
      can('cancel') ? h('button', {
        class: 'btn btn-outline-danger', type: 'button',
        onclick: () => decide('cancel', {
          reasonNeeded: true,
          confirmText: `Cancel ${pr.PrNumber}? It stays on file but cannot be reopened. The shortage on the RF stays.`,
          done: 'Cancelled. The purchaser has been notified.',
        }),
      }, 'Cancel purchase requisition') : null),
    formError);
}

// Shown to both roles once the PO exists.
function poPanel(pr) {
  if (!pr.po) return null;
  return h('div', { class: 'panel p-3 mt-4 d-flex flex-wrap align-items-center gap-2' },
    h('span', null, 'Purchase order'),
    h('a', { href: `/po.html?id=${pr.po.PurchaseOrderId}`, class: 'fw-semibold' }, pr.po.PoNumber),
    poBadge(pr.po.Status));
}

// The purchaser makes the purchase order from an approved PR. The boxes start with the values the server would
// use if they were left empty, and the total preview does the same whole-centavo sum as the server.
function poForm(pr) {
  const d = pr.poDefaults;
  const discount = h('input', {
    class: 'form-control', id: 'po-discount', inputMode: 'decimal', autocomplete: 'off', value: String(d.discountPercent), style: 'max-width: 8rem;',
  });
  const date = h('input', { class: 'form-control', id: 'po-date', type: 'date', min: todayLocal(), value: d.expectedDeliveryDate || '', style: 'max-width: 12rem;' });
  const terms = h('input', { class: 'form-control', id: 'po-terms', maxLength: 100, autocomplete: 'off', value: d.paymentTerms });
  const point = h('input', { class: 'form-control', id: 'po-point', maxLength: 200, autocomplete: 'off', value: d.deliveryPoint });
  const formError = h('p', { class: 'status-bad small mt-3 mb-0', role: 'alert', hidden: true });
  const discountLabel = h('td', { class: 'text-end' });
  const discountCell = h('td', { class: 'num' });
  const totalCell = h('th', { class: 'num' });
  const subtotal = pr.TotalCentavos;

  function recalc() {
    const percent = toPercent(discount.value);
    if (percent === null) {
      discountLabel.textContent = 'Less: discount';
      discountCell.textContent = '';
      totalCell.textContent = '';
      return;
    }
    const off = discountOf(subtotal, percent);
    discountLabel.textContent = `Less: ${qty(percent)}% discount`;
    discountCell.textContent = pesos(off);
    totalCell.textContent = pesos(subtotal - off);
  }
  discount.addEventListener('input', () => { showError(formError, ''); recalc(); });

  const button = h('button', { class: 'btn btn-ximon mt-3', type: 'button' }, 'Make purchase order');
  async function make() {
    showError(formError, '');
    showError(errorBox, '');
    const percent = toPercent(discount.value);
    if (percent === null) { showError(formError, PERCENT_ERROR); return; }
    if (date.value && date.value < todayLocal()) { showError(formError, 'The expected delivery date cannot be in the past.'); return; }
    const total = subtotal - discountOf(subtotal, percent);
    if (!window.confirm(`Make the purchase order for PHP ${pesos(total)}? Only one purchase order can be made from this requisition.`)) return;
    button.disabled = true;
    try {
      const made = await api(`/api/purchasing/prs/${id}/po`, {
        method: 'POST',
        body: { discountPercent: percent, expectedDeliveryDate: date.value, paymentTerms: terms.value.trim(), deliveryPoint: point.value.trim() },
      });
      location.href = `/po.html?id=${made.id}&new=1`;
    } catch (err) {
      button.disabled = false;
      showError(formError, err.message);
    }
  }
  button.addEventListener('click', make);

  recalc();
  return h('div', { class: 'panel p-3 mt-4' },
    h('h2', { class: 'h6' }, 'Make purchase order'),
    h('p', { class: 'hint' }, 'The supplier, quantities and prices come from this requisition. Fill in the rest, then make the order. Leave a box empty to use what is shown.'),
    h('div', { class: 'row g-3' },
      h('div', { class: 'col-md-4' }, h('label', { class: 'form-label', htmlFor: 'po-discount' }, 'Discount (%)'), discount),
      h('div', { class: 'col-md-4' }, h('label', { class: 'form-label', htmlFor: 'po-date' }, 'Expected delivery date'), date),
      h('div', { class: 'col-md-4' }, h('label', { class: 'form-label', htmlFor: 'po-terms' }, 'Payment terms'), terms),
      h('div', { class: 'col-12' }, h('label', { class: 'form-label', htmlFor: 'po-point' }, 'Delivery point'), point)),
    h('table', { class: 'table mb-0 mt-3', style: 'max-width: 26rem; margin-left: auto;' },
      h('tbody', null,
        h('tr', null, h('td', { class: 'text-end' }, 'Subtotal'), h('td', { class: 'num' }, pesos(subtotal))),
        h('tr', null, discountLabel, discountCell),
        h('tr', null, h('th', { class: 'text-end' }, 'Total (PHP)'), totalCell))),
    formError,
    button);
}

function historyTable(pr) {
  return h('div', null,
    h('h2', { class: 'h6 mt-4' }, 'History'),
    h('div', { class: 'panel table-responsive' },
      h('table', { class: 'table mb-0' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Change'), h('th', null, 'Reason'))),
        h('tbody', null, pr.history.map((e) => h('tr', null,
          h('td', null, e.ChangedAt),
          h('td', null, e.ChangedByName),
          h('td', null, e.FromStatus ? `${PR_LABELS[e.FromStatus]} to ${PR_LABELS[e.ToStatus]}` : `Created as ${PR_LABELS[e.ToStatus].toLowerCase()}`),
          h('td', null, e.Reason || '')))))));
}

async function load() {
  showError(errorBox, '');
  try {
    const pr = await api(`/api/purchasing/prs/${encodeURIComponent(id)}`);
    // Only the purchaser prices, so only the purchaser needs the supplier list.
    const suppliers = pr.canPrice ? await api('/api/purchasing/suppliers') : [];
    // filter(Boolean): replaceChildren would print the word "null" for a missing block
    content.replaceChildren(...[
      h('div', { class: 'd-flex align-items-center gap-3 mb-3' }, h('h1', { class: 'h5 mb-0' }, pr.PrNumber), prBadge(pr.Status)),
      flash ? h('p', { class: 'status-ok', role: 'status' }, flash) : null,
      h('div', { class: 'panel p-3' }, info(pr)),
      poPanel(pr),
      pr.canPrice ? pricingForm(pr, suppliers) : linesTable(pr),
      pr.canMakePo ? poForm(pr) : null,
      decisionPanel(pr),
      historyTable(pr),
    ].filter(Boolean));
    flash = '';
  } catch (err) {
    content.replaceChildren();
    showError(errorBox, err.message);
  }
}

async function start() {
  user = await startPage(['purchaser', 'owner']);
  if (!id) { showError(errorBox, 'No purchase requisition chosen.'); return; }
  await load();
}

start();
