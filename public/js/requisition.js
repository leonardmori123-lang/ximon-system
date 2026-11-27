// Requisition form detail view, approval, return, and cancellation.
const content = document.getElementById('content');
const errorBox = document.getElementById('error');
const id = new URLSearchParams(location.search).get('id');
let user;

function info(rf) {
  const pairs = [
    ['Project', `${rf.ProjectCode}, ${rf.ProjectName}`],
    ['Requested by', rf.RequestedByName],
    ['Filed', rf.CreatedAt],
    ['Date needed', rf.DateNeeded],
    ['Urgency', sentence(rf.Urgency)],
    ['Purpose', rf.Purpose],
  ];
  if (rf.ReturnReason) {
    pairs.push(['Last return reason', rf.ReturnReason]);
  }
  if (rf.RevisionCount > 0) {
    pairs.push(['Revisions', String(rf.RevisionCount)]);
  }
  return h('dl', { class: 'info-grid' }, pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

const STOCK_STATUSES = ['approved', 'partly_fulfilled', 'fulfilled'];

function linesTable(rf) {
  const showStock = STOCK_STATUSES.includes(rf.Status);
  return h('div', { class: 'panel table-responsive mt-4' },
    h('table', { class: 'table mb-0' },
      h('thead', null, h('tr', null,
        h('th', null, 'Code'), h('th', null, 'Description'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Quantity'),
        showStock ? h('th', { class: 'num' }, 'Reserved') : null,
        showStock ? h('th', { class: 'num' }, 'Issued') : null,
        showStock ? h('th', { class: 'num' }, 'Short') : null)),
      h('tbody', null, rf.lines.map((l) => h('tr', null,
        h('td', null, l.Code), h('td', null, l.Description), h('td', null, l.Unit), h('td', { class: 'num' }, qty(l.Quantity)),
        showStock ? h('td', { class: 'num' }, qty(l.QtyReserved)) : null,
        showStock ? h('td', { class: 'num' }, qty(l.QtyIssued)) : null,
        showStock ? h('td', { class: 'num' }, Number(l.QtyShort) > 0 ? h('strong', { class: 'status-bad' }, qty(l.QtyShort)) : qty(l.QtyShort)) : null)))));
}

function stockNote(rf) {
  if (!STOCK_STATUSES.includes(rf.Status)) {
    return null;
  }
  if (rf.Status === 'fulfilled') {
    return h('p', { class: 'hint mt-2 mb-0' }, 'All items were issued. This requisition is closed.');
  }
  const short = rf.lines.filter((l) => Number(l.QtyShort) > 0).length;
  if (short === 0) {
    return h('p', { class: 'hint mt-2 mb-0' }, 'All items are reserved for this project.');
  }
  if (rf.purchaseRequisitions.length > 0) {
    return null;
  }
  const itemWords = short === 1 ? '1 item is' : `${short} items are`;
  return h('p', { class: 'hint mt-2 mb-0' }, `${itemWords} short of stock. A purchase requisition is needed for the shortage.`);
}

const PR_STATUSES = {
  pending: { label: 'Pending approval', color: 'text-bg-warning' },
  approved: { label: 'Approved', color: 'text-bg-success' },
  on_hold: { label: 'On hold', color: 'text-bg-info' },
  cancelled: { label: 'Cancelled', color: 'text-bg-secondary' },
};

const PO_STATUSES = {
  open: { label: 'Open', color: 'text-bg-primary' },
  partly_delivered: { label: 'Partly delivered', color: 'text-bg-warning' },
  closed: { label: 'Closed', color: 'text-bg-success' },
};

function documentStatus(statuses, status) {
  const known = statuses[status] || { label: status, color: 'text-bg-light' };
  return h('span', { class: `badge ${known.color}` }, known.label);
}

// The numbers are plain text on purpose: the foreman cannot open the PR and PO pages.
function documentTrail(rf) {
  if (rf.purchaseRequisitions.length === 0 && rf.purchaseOrders.length === 0) {
    return null;
  }
  const rows = [];
  for (const pr of rf.purchaseRequisitions) {
    rows.push(h('tr', null,
      h('td', null, 'Purchase requisition'), h('td', null, pr.PrNumber), h('td', null, documentStatus(PR_STATUSES, pr.Status))));
  }
  for (const po of rf.purchaseOrders) {
    rows.push(h('tr', null,
      h('td', null, 'Purchase order'), h('td', null, po.PoNumber), h('td', null, documentStatus(PO_STATUSES, po.Status))));
  }
  return h('div', null,
    h('h2', { class: 'h6 mt-4' }, 'Document Trail'),
    h('div', { class: 'panel table-responsive' },
      h('table', { class: 'table mb-0' },
        h('thead', null, h('tr', null, h('th', null, 'Document'), h('th', null, 'Number'), h('th', null, 'Status'))),
        h('tbody', null, rows))));
}

function slipsPanel(rf) {
  if (!rf.slips || !rf.slips.length) {
    return null;
  }
  return h('div', null,
    h('h2', { class: 'h6 mt-4' }, 'Issuance slips'),
    h('div', { class: 'panel table-responsive' },
      h('table', { class: 'table mb-0' },
        h('thead', null, h('tr', null, h('th', null, 'Slip'), h('th', null, 'Status'), h('th', null, 'Prepared'))),
        h('tbody', null, rf.slips.map((sl) => h('tr', null,
          h('td', null, h('a', { href: `/slip.html?id=${sl.SlipId}` }, sl.SlipNumber)),
          h('td', null, slipBadge(sl.Status)),
          h('td', null, sl.PreparedAt)))))));
}

function historyTable(rf) {
  return h('div', null,
    h('h2', { class: 'h6 mt-4' }, 'History'),
    h('div', { class: 'panel table-responsive' },
      h('table', { class: 'table mb-0' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Change'), h('th', null, 'Reason'))),
        h('tbody', null, rf.history.map((e) => h('tr', null,
          h('td', null, e.ChangedAt),
          h('td', null, e.ChangedByName),
          h('td', null, e.FromStatus ? `${STATUS_LABELS[e.FromStatus]} to ${STATUS_LABELS[e.ToStatus]}` : `Filed as ${STATUS_LABELS[e.ToStatus].toLowerCase()}`),
          h('td', null, e.Reason || '')))))));
}

async function act(path, body, confirmText) {
  if (confirmText && !window.confirm(confirmText)) {
    return;
  }
  try {
    await api(`/api/requisitions/${id}/${path}`, { method: 'POST', body });
    await load();
  } catch (err) {
    showError(errorBox, err.message);
    errorBox.scrollIntoView({ block: 'nearest' });
  }
}

function actions(rf) {
  if (user.role === 'owner' && rf.Status === 'pending') {
    const reason = h('textarea', { class: 'form-control', id: 'return-reason', rows: 2, maxLength: 300, placeholder: 'Reason, required when returning' });
    return h('div', { class: 'panel p-3 mt-4' },
      h('div', { class: 'd-flex gap-2 mb-3' },
        h('button', { class: 'btn btn-success', type: 'button', onclick: () => act('approve') }, 'Approve')),
      h('label', { class: 'form-label', htmlFor: 'return-reason' }, 'Return to the requestor'),
      reason,
      h('button', { class: 'btn btn-outline-secondary mt-2', type: 'button', onclick: () => act('return', { reason: reason.value }) }, 'Return with reason'));
  }
  if (user.role === 'owner' && rf.Status === 'approved') {
    const released = (rf.slips || []).find((sl) => sl.Status === 'released');
    if (released) {
      return h('div', { class: 'panel p-3 mt-4' },
        h('p', { class: 'mb-0' }, `${released.SlipNumber} was already released to the requestor, so this requisition cannot be cancelled now.`));
    }
    const reason = h('textarea', { class: 'form-control', id: 'cancel-reason', rows: 2, maxLength: 300, placeholder: 'Reason, required' });
    return h('div', { class: 'panel p-3 mt-4' },
      h('label', { class: 'form-label', htmlFor: 'cancel-reason' }, 'Cancel this requisition'),
      h('p', { class: 'hint mb-2' }, 'The items reserved for it go back to free stock, and a prepared issuance slip is cancelled. A purchase requisition already made for it is not changed.'),
      reason,
      h('button', { class: 'btn btn-outline-danger mt-2', type: 'button', id: 'cancel-approved',
        onclick: () => act('cancel-approved', { reason: reason.value }, `Cancel ${rf.RfNumber}? Its reserved items are released. It stays on file but cannot be reopened.`) }, 'Cancel requisition'));
  }
  if (user.role === 'foreman' && rf.Status === 'pending' && rf.RequestedBy === user.id) {
    return h('div', { class: 'panel p-3 mt-4' },
      h('p', { class: 'mb-2' }, 'The owner has not decided yet. If you no longer need these items, you can cancel this requisition.'),
      h('button', { class: 'btn btn-outline-secondary', type: 'button', id: 'cancel-pending',
        onclick: () => act('cancel', {}, 'Cancel this requisition? It stays on file but cannot be reopened.') }, 'Cancel requisition'));
  }
  if (user.role === 'foreman' && rf.Status === 'returned' && rf.RequestedBy === user.id) {
    return h('div', { class: 'panel p-3 mt-4' },
      h('p', { class: 'mb-2' }, rf.canRevise
        ? 'The owner returned this requisition. Revise it and send it again, or cancel it.'
        : 'This requisition was already revised once, so it can only be cancelled. File a new one if you still need the items.'),
      h('div', { class: 'd-flex gap-2' },
        rf.canRevise ? h('a', { class: 'btn btn-ximon', href: `/rf-form.html?id=${rf.RequisitionId}` }, 'Revise and resubmit') : null,
        h('button', { class: 'btn btn-outline-secondary', type: 'button',
          onclick: () => act('cancel', {}, 'Cancel this requisition? It stays on file but cannot be reopened.') }, 'Cancel requisition')));
  }
  return null;
}

async function load() {
  showError(errorBox, '');
  try {
    const rf = await api(`/api/requisitions/${encodeURIComponent(id)}`);
    content.replaceChildren(...[
      h('div', { class: 'd-flex align-items-center gap-3 mb-3' }, h('h1', { class: 'h5 mb-0' }, rf.RfNumber), statusBadge(rf.Status)),
      h('div', { class: 'panel p-3' }, info(rf)),
      linesTable(rf),
      stockNote(rf),
      documentTrail(rf),
      slipsPanel(rf),
      actions(rf),
      historyTable(rf),
    ].filter(Boolean));
  } catch (err) {
    content.replaceChildren();
    showError(errorBox, err.message);
  }
}

async function start() {
  user = await startPage(['owner', 'foreman']);
  if (!id) {
    showError(errorBox, 'No requisition chosen.');
    return;
  }
  await load();
}

start();
