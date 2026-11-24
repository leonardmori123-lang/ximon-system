// Requisition forms list with status filtering.
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const statusSelect = document.getElementById('status');

async function load() {
  showError(errorBox, '');
  const status = statusSelect.value;
  try {
    const url = status ? `/api/requisitions?status=${encodeURIComponent(status)}` : '/api/requisitions';
    const list = await api(url);
    rows.replaceChildren(...list.map((r) => h('tr', null,
      h('td', null, h('a', { href: `/requisition.html?id=${r.RequisitionId}` }, r.RfNumber)),
      h('td', null, r.ProjectCode),
      h('td', null, r.DateNeeded),
      h('td', null, sentence(r.Urgency)),
      h('td', null, statusBadge(r.Status)),
      h('td', null, r.RequestedByName),
      h('td', null, r.CreatedAt))));
    empty.hidden = list.length > 0;
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  const user = await startPage(['owner', 'foreman']);
  const isOwner = user.role === 'owner';
  document.getElementById('title').textContent = isOwner ? 'Requisitions to review' : 'My requisitions';
  document.getElementById('new').hidden = isOwner;

  statusSelect.replaceChildren(
    h('option', { value: '' }, 'All statuses'),
    ...Object.entries(STATUS_LABELS).map(([value, label]) => h('option', { value }, label)));
  statusSelect.value = isOwner ? 'pending' : '';
  statusSelect.addEventListener('change', load);
  await load();
}

start();
