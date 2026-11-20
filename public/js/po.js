const content = document.getElementById('content');
const errorBox = document.getElementById('error');
const params = new URLSearchParams(location.search);
const id = params.get('id');

function info(po) {
  const supplierDetails = [po.SupplierContact, po.SupplierPhone, po.SupplierEmail, po.SupplierAddress].filter(Boolean).join(', ');
  const prCell = !po.PrNumber ? 'None' : h('a', { href: `/pr.html?id=${po.PurchaseRequisitionId}` }, po.PrNumber);
  const pairs = [
    ['Purchase requisition', prCell],
    ['Supplier', po.SupplierName],
    ['Supplier details', supplierDetails || 'None saved'],
    ['Project', `${po.ProjectCode}, ${po.ProjectName}`],
    ['Payment terms', po.PaymentTerms || 'Not set'],
    ['Expected delivery', po.ExpectedDeliveryDate || 'Not set'],
    ['Delivery point', po.DeliveryPoint || 'Not set'],
    ['Made by', `${po.CreatedByName}, ${po.CreatedAt}`],
  ];
  return h('dl', { class: 'info-grid' }, pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

// The lines, then the totals laid out like the client's PO: subtotal, discount, other discounts, shipping, total.
function linesTable(po) {
  const totalRow = (label, value, bold) => h('tr', null,
    h(bold ? 'th' : 'td', { colSpan: 6, class: 'text-end' }, label),
    h(bold ? 'th' : 'td', { class: 'num' }, value));
  return h('div', { class: 'panel table-responsive mt-4' },
    h('table', { class: 'table mb-0' },
      h('thead', null, h('tr', null,
        h('th', null, 'Code'), h('th', null, 'Description'), h('th', null, 'Unit'),
        h('th', { class: 'num' }, 'Ordered'), h('th', { class: 'num' }, 'Received'),
        h('th', { class: 'num' }, 'Unit price (PHP)'), h('th', { class: 'num' }, 'Line total (PHP)'))),
      h('tbody', null,
        po.lines.map((l) => h('tr', null,
          h('td', { class: 'text-nowrap' }, l.Code), h('td', null, l.Description), h('td', null, l.Unit),
          h('td', { class: 'num' }, qty(l.Quantity)), h('td', { class: 'num' }, qty(l.QtyReceived)),
          h('td', { class: 'num' }, pesos(l.UnitPriceCentavos)), h('td', { class: 'num' }, pesos(l.LineTotalCentavos)))),
        totalRow('Subtotal', pesos(po.SubtotalCentavos)),
        totalRow(`Less: ${qty(po.DiscountPercent)}% discount`, pesosOrDash(po.DiscountCentavos)),
        totalRow('Other discounts', pesosOrDash(po.OtherDiscountCentavos)),
        totalRow('Shipping', pesosOrDash(po.ShippingCentavos)),
        totalRow('Total', pesos(po.TotalCentavos), true))));
}

function historyTable(po) {
  return h('div', null,
    h('h2', { class: 'h6 mt-4' }, 'History'),
    h('div', { class: 'panel table-responsive' },
      h('table', { class: 'table mb-0' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Change'))),
        h('tbody', null, po.history.map((e) => h('tr', null,
          h('td', null, e.ChangedAt),
          h('td', null, e.ChangedByName),
          h('td', null, e.FromStatus ? `${PO_LABELS[e.FromStatus]} to ${PO_LABELS[e.ToStatus]}` : `Made as ${PO_LABELS[e.ToStatus].toLowerCase()}`)))))));
}

async function load() {
  showError(errorBox, '');
  try {
    const po = await api(`/api/purchasing/pos/${encodeURIComponent(id)}`);
    content.replaceChildren(...[
      h('div', { class: 'd-flex flex-wrap align-items-center gap-3 mb-3' },
        h('h1', { class: 'h5 mb-0' }, po.PoNumber), poBadge(po.Status),
        h('a', { class: 'btn btn-outline-secondary btn-sm', href: `/po-print.html?id=${po.PurchaseOrderId}` }, 'Print view')),
      params.get('new') ? h('p', { class: 'status-ok', role: 'status' }, 'Purchase order made. Open the print view to print it.') : null,
      h('div', { class: 'panel p-3' }, info(po)),
      linesTable(po),
      historyTable(po),
    ].filter(Boolean));
  } catch (err) {
    content.replaceChildren();
    showError(errorBox, err.message);
  }
}

async function start() {
  await startPage(['purchaser', 'owner']);
  if (!id) { showError(errorBox, 'No purchase order chosen.'); return; }
  await load();
}

start();
