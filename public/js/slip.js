const content = document.getElementById('content');
const errorBox = document.getElementById('error');
const id = new URLSearchParams(location.search).get('id');
let user;

function info(s) {
  const pairs = [
    ['Requisition', user.role === 'custodian' ? s.RfNumber : h('a', { href: `/requisition.html?id=${s.RequisitionId}` }, s.RfNumber)],
    ['Project', `${s.ProjectCode}, ${s.ProjectName}`],
    ['Requested by', s.RequestedByName],
    ['Purpose', s.Purpose],
    ['Prepared', `${s.PreparedAt} by ${s.PreparedByName}`],
  ];
  if (s.ReleasedAt) pairs.push(['Released', `${s.ReleasedAt} by ${s.ReleasedByName}`]);
  if (s.AcknowledgedAt) pairs.push(['Received', `${s.AcknowledgedAt} by ${s.AcknowledgedByName}`]);
  if (s.Remarks) pairs.push(['Remarks', s.Remarks]);
  return h('dl', { class: 'info-grid' }, pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

function linesTable(s) {
  return h('div', { class: 'panel table-responsive mt-4' },
    h('table', { class: 'table mb-0' },
      h('thead', null, h('tr', null, h('th', null, 'Code'), h('th', null, 'Description'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Quantity'))),
      h('tbody', null, s.lines.map((l) => h('tr', null,
        h('td', null, l.Code), h('td', null, l.Description), h('td', null, l.Unit), h('td', { class: 'num' }, qty(l.Quantity)))))));
}

function historyTable(s) {
  return h('div', null,
    h('h2', { class: 'h6 mt-4' }, 'History'),
    h('div', { class: 'panel table-responsive' },
      h('table', { class: 'table mb-0' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Change'), h('th', null, 'Remarks'))),
        h('tbody', null, s.history.map((e) => h('tr', null,
          h('td', null, e.ChangedAt), h('td', null, e.ChangedByName),
          h('td', null, e.FromStatus ? `${SLIP_LABELS[e.FromStatus]} to ${SLIP_LABELS[e.ToStatus]}` : `Prepared`),
          h('td', null, e.Reason || '')))))));
}

async function act(path, body, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  try {
    await api(`/api/slips/${id}/${path}`, { method: 'POST', body });
    await load();
  } catch (err) {
    showError(errorBox, err.message);
  }
}

function actions(s) {
  if (user.role === 'custodian' && s.Status === 'prepared') {
    return h('div', { class: 'panel p-3 mt-4' },
      h('p', { class: 'mb-2' }, 'Hand the items to the requestor, then release the slip. Stock is deducted only after the requestor confirms receipt.'),
      h('div', { class: 'd-flex gap-2' },
        h('button', { class: 'btn btn-ximon', type: 'button', onclick: () => act('release') }, 'Release items'),
        h('button', { class: 'btn btn-outline-secondary', type: 'button',
          onclick: () => act('cancel', {}, 'Cancel this slip? You can prepare a new one afterwards.') }, 'Cancel slip')));
  }
  if (user.role === 'custodian' && s.Status === 'released') {
    return h('p', { class: 'hint mt-3 mb-0' }, 'Released. Waiting for the requestor to confirm receipt.');
  }
  if (user.role === 'foreman' && s.Status === 'released' && s.RequestedBy === user.id) {
    const remarks = h('input', { class: 'form-control', id: 'remarks', maxLength: 200, placeholder: 'Remarks (optional)' });
    const sure = h('input', { class: 'form-check-input', type: 'checkbox', id: 'sure' });
    const button = h('button', { class: 'btn btn-ximon', type: 'button', disabled: true,
      onclick: () => act('acknowledge', { remarks: remarks.value }) }, 'Confirm receipt');
    sure.addEventListener('change', () => { button.disabled = !sure.checked; });
    return h('div', { class: 'panel p-3 mt-4' },
      h('p', { class: 'mb-3' }, 'Check the items you received against this slip, then confirm.'),
      h('div', { class: 'mb-3' }, remarks),
      h('div', { class: 'form-check mb-3' }, sure,
        h('label', { class: 'form-check-label', htmlFor: 'sure' }, 'I received these items and checked them against the slip.')),
      button);
  }
  return null;
}

async function load() {
  showError(errorBox, '');
  try {
    const s = await api(`/api/slips/${encodeURIComponent(id)}`);
    content.replaceChildren(...[
      h('div', { class: 'd-flex align-items-center gap-3 mb-3' }, h('h1', { class: 'h5 mb-0' }, s.SlipNumber), slipBadge(s.Status)),
      h('div', { class: 'panel p-3' }, info(s)),
      linesTable(s),
      actions(s),
      historyTable(s),
    ].filter(Boolean));
  } catch (err) {
    content.replaceChildren();
    showError(errorBox, err.message);
  }
}

async function start() {
  user = await startPage(['owner', 'custodian', 'foreman']);
  if (!id) { showError(errorBox, 'No slip chosen.'); return; }
  await load();
}

start();
