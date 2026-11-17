const errorBox = document.getElementById('error');
const statusSelect = document.getElementById('status');
let user;

async function loadReady() {
  const list = await api('/api/slips/releasable');
  document.getElementById('ready-rows').replaceChildren(...list.map((r) => h('tr', null,
    h('td', null, r.RfNumber), h('td', null, r.ProjectCode), h('td', null, r.RequestedByName),
    h('td', null, r.DateNeeded), h('td', null, sentence(r.Urgency)), h('td', { class: 'num' }, r.LinesToRelease),
    h('td', { class: 'text-end' }, h('button', { class: 'btn btn-sm btn-ximon', type: 'button', onclick: () => prepare(r.RequisitionId) }, 'Prepare slip')))));
  document.getElementById('ready-empty').hidden = list.length > 0;
}

async function prepare(requisitionId) {
  showError(errorBox, '');
  try {
    const result = await api('/api/slips', { method: 'POST', body: { requisitionId } });
    location.href = `/slip.html?id=${result.id}`;
  } catch (err) {
    showError(errorBox, err.message);
    await loadReady();
  }
}

async function loadSlips() {
  const status = statusSelect.value;
  const list = await api(status ? `/api/slips?status=${encodeURIComponent(status)}` : '/api/slips');
  document.getElementById('rows').replaceChildren(...list.map((s) => h('tr', null,
    h('td', null, h('a', { href: `/slip.html?id=${s.SlipId}` }, s.SlipNumber)),
    h('td', null, s.RfNumber), h('td', null, s.ProjectCode), h('td', null, s.RequestedByName),
    h('td', null, slipBadge(s.Status)), h('td', null, s.PreparedAt), h('td', { class: 'num' }, s.LineCount))));
  document.getElementById('empty').hidden = list.length > 0;
}

async function load() {
  showError(errorBox, '');
  try {
    if (user.role === 'custodian') await loadReady();
    await loadSlips();
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  user = await startPage(['owner', 'custodian', 'foreman']);
  const isForeman = user.role === 'foreman';
  document.getElementById('title').textContent = isForeman ? 'Confirm issued items' : 'Issuance slips';
  document.getElementById('ready').hidden = user.role !== 'custodian';
  const note = document.getElementById('note');
  if (isForeman) {
    note.textContent = 'Slips marked Released are waiting for you. Open one, check the items, and confirm that you received them.';
    note.hidden = false;
  }
  statusSelect.replaceChildren(
    h('option', { value: '' }, 'All statuses'),
    ...Object.entries(SLIP_LABELS).map(([value, label]) => h('option', { value }, label)));
  statusSelect.value = isForeman ? 'released' : '';
  statusSelect.addEventListener('change', load);
  await load();
}

start();
