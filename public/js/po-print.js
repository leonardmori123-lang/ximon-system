// Printable purchase order document view.
const sheet = document.getElementById('sheet');
const errorBox = document.getElementById('error');
const id = new URLSearchParams(location.search).get('id');

function money(centavos) {
  return pesos(centavos);
}

function pair(label, value) {
  return [h('dt', null, label), h('dd', null, value || '-')];
}

function render(po) {
  const supplierLines = [po.SupplierContact, po.SupplierAddress, po.SupplierPhone, po.SupplierEmail].filter(Boolean);

  function totalRow(label, value, extra = '') {
    return h('tr', { class: extra },
      h('td', { colSpan: 6, class: 'label' }, label),
      h('td', { class: 'num' }, value)
    );
  }

  return h('div', { class: 'sheet' },
    h('div', { class: 'head' },
      h('div', null, h('div', { class: 'company' }, 'XIMON ENGINEERING SERVICES')),
      h('div', { class: 'title' },
        h('h1', null, 'PURCHASE ORDER'),
        h('div', null, `PO No. ${po.PoNumber}`),
        h('div', null, `Date: ${po.CreatedAt.slice(0, 10)}`))),

    h('div', { class: 'blocks' },
      h('div', { class: 'block' },
        h('h2', null, 'Supplier'),
        h('p', null, h('strong', null, po.SupplierName)),
        ...supplierLines.map((line) => h('p', null, line))),
      h('div', { class: 'block' },
        h('h2', null, 'Order details'),
        h('dl', { class: 'pair' },
          ...pair('Project', `${po.ProjectCode}, ${po.ProjectName}`),
          ...pair('Delivery point', po.DeliveryPoint),
          ...pair('Expected delivery', po.ExpectedDeliveryDate),
          ...pair('Payment terms', po.PaymentTerms),
          ...pair('Requisition', po.PrNumber)))),

    h('table', { class: 'lines' },
      h('thead', null, h('tr', null,
        h('th', { class: 'center' }, '#'), h('th', null, 'Item code'), h('th', null, 'Description'), h('th', null, 'Unit'),
        h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Unit price (₱)'), h('th', { class: 'num' }, 'Total (₱)'))),
      h('tbody', null, po.lines.map((l, i) => h('tr', null,
        h('td', { class: 'center' }, i + 1), h('td', { class: 'code' }, l.Code), h('td', null, l.Description), h('td', null, l.Unit),
        h('td', { class: 'num' }, qty(l.Quantity)), h('td', { class: 'num' }, money(l.UnitPriceCentavos)), h('td', { class: 'num' }, money(l.LineTotalCentavos))))),
      h('tfoot', null,
        totalRow('Subtotal', money(po.SubtotalCentavos)),
        totalRow(`Less: ${qty(po.DiscountPercent)}% discount`, pesosOrDash(po.DiscountCentavos)),
        totalRow('Other discounts', pesosOrDash(po.OtherDiscountCentavos)),
        totalRow('Shipping', pesosOrDash(po.ShippingCentavos)),
        totalRow('Total', money(po.TotalCentavos), 'grand'))),

    h('div', { class: 'signatures' },
      h('div', null, h('div', { class: 'name' }, po.CreatedByName), h('div', { class: 'line' }, 'Prepared by (Purchaser)')),
      h('div', null, h('div', { class: 'name' }), h('div', { class: 'line' }, 'Approved by (Owner or manager)'))));
}

async function start() {
  await startPage(['purchaser', 'owner']);
  document.getElementById('print').addEventListener('click', () => window.print());
  if (!id) {
    showError(errorBox, 'No purchase order chosen.');
    return;
  }
  document.getElementById('back').href = `/po.html?id=${encodeURIComponent(id)}`;
  try {
    const po = await api(`/api/purchasing/pos/${encodeURIComponent(id)}`);
    document.title = `${po.PoNumber} | Ximon`;
    sheet.replaceChildren(render(po));
  } catch (err) {
    showError(errorBox, err.message);
  }
}

start();
