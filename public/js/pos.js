// Purchase orders list with status filtering.
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const statusSelect = document.getElementById('status');
let isVerifier = false;

async function load() {
  showError(errorBox, '');
  const status = statusSelect.value;
  try {
    const url = status ? `/api/purchasing/pos?status=${encodeURIComponent(status)}` : '/api/purchasing/pos';
    const list = await api(url);
    rows.replaceChildren(...list.map((p) => {
      let prCell = p.PrNumber || '';
      if (p.PrNumber && !isVerifier) {
        prCell = h('a', { href: `/pr.html?id=${p.PurchaseRequisitionId}` }, p.PrNumber);
      }
      return h('tr', null,
        h('td', null, h('a', { href: `/po.html?id=${p.PurchaseOrderId}` }, p.PoNumber)),
        h('td', null, prCell),
        h('td', null, p.SupplierName),
        h('td', null, p.ProjectCode),
        h('td', null, p.ExpectedDeliveryDate || ''),
        isVerifier ? null : h('td', { class: 'num' }, pesos(p.TotalCentavos)),
        h('td', null, poBadge(p.Status)),
        h('td', null, p.CreatedAt));
    }));
    empty.hidden = list.length > 0;
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  const user = await startPage(['purchaser', 'owner', 'verifier']);
  isVerifier = user.role === 'verifier';
  document.getElementById('total-head').hidden = isVerifier;
  statusSelect.replaceChildren(
    h('option', { value: '' }, 'All statuses'),
    ...Object.entries(PO_LABELS).map(([value, label]) => h('option', { value }, label)));
  statusSelect.addEventListener('change', load);
  await load();
}

start();
