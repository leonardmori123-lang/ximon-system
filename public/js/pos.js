const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const statusSelect = document.getElementById('status');

async function load() {
  showError(errorBox, '');
  const status = statusSelect.value;
  try {
    const list = await api(status ? `/api/purchasing/pos?status=${encodeURIComponent(status)}` : '/api/purchasing/pos');
    rows.replaceChildren(...list.map((p) => h('tr', null,
      h('td', null, h('a', { href: `/po.html?id=${p.PurchaseOrderId}` }, p.PoNumber)),
      h('td', null, p.PrNumber ? h('a', { href: `/pr.html?id=${p.PurchaseRequisitionId}` }, p.PrNumber) : ''),
      h('td', null, p.SupplierName),
      h('td', null, p.ProjectCode),
      h('td', null, p.ExpectedDeliveryDate || ''),
      h('td', { class: 'num' }, pesos(p.TotalCentavos)),
      h('td', null, poBadge(p.Status)),
      h('td', null, p.CreatedAt))));
    empty.hidden = list.length > 0;
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  await startPage(['purchaser', 'owner']);
  statusSelect.replaceChildren(
    h('option', { value: '' }, 'All statuses'),
    ...Object.entries(PO_LABELS).map(([value, label]) => h('option', { value }, label)));
  statusSelect.addEventListener('change', load);
  await load();
}

start();
