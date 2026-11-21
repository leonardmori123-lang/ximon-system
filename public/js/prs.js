const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const statusSelect = document.getElementById('status');

async function load() {
  showError(errorBox, '');
  const status = statusSelect.value;
  try {
    const list = await api(status ? `/api/purchasing/prs?status=${encodeURIComponent(status)}` : '/api/purchasing/prs');
    rows.replaceChildren(...list.map((p) => h('tr', null,
      h('td', null, h('a', { href: `/pr.html?id=${p.PurchaseRequisitionId}` }, p.PrNumber)),
      h('td', null, p.RfNumber || '', p.RfStatus === 'cancelled' ? h('span', { class: 'badge text-bg-secondary ms-1' }, 'RF cancelled') : null),
      h('td', null, p.ProjectCode),
      h('td', null, p.SupplierName || ''),
      h('td', { class: 'num' }, `${p.PricedCount} of ${p.LineCount}`),
      h('td', { class: 'num' }, p.TotalCentavos == null ? '' : pesos(p.TotalCentavos)),
      h('td', null, prBadge(p.Status), p.OverBudget ? h('span', { class: 'badge text-bg-danger ms-1' }, 'Over budget') : null),
      h('td', null, p.CreatedAt))));
    empty.hidden = list.length > 0;
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  const user = await startPage(['purchaser', 'owner']);
  const isOwner = user.role === 'owner';
  document.getElementById('title').textContent = isOwner ? 'Purchase requisitions to approve' : 'Purchase requisitions';

  statusSelect.replaceChildren(
    h('option', { value: '' }, 'All statuses'),
    ...Object.entries(PR_LABELS).map(([value, label]) => h('option', { value }, label)));
  statusSelect.value = isOwner ? 'pending' : '';
  statusSelect.addEventListener('change', load);
  await load();
}

start();
