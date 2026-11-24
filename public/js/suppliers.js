// Supplier management and item catalog pricing.
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const form = document.getElementById('supplier-form');
const formError = document.getElementById('form-error');
const pricesSection = document.getElementById('prices');
const priceRows = document.getElementById('price-rows');

function field(id) {
  return document.getElementById(id);
}

let suppliers = [];
let editingId = null;
let pricedSupplierId = null;

function render() {
  rows.replaceChildren(...suppliers.map((s) => h('tr', { class: s.IsActive ? '' : 'text-muted' },
    h('td', null, h('strong', null, s.Name)),
    h('td', null, [s.ContactPerson, s.Phone].filter(Boolean).join(', ')),
    h('td', null, s.PaymentTerms || ''),
    h('td', { class: 'num' }, s.LeadTimeDays),
    h('td', { class: 'num' }, s.PriceCount),
    h('td', null, s.IsActive ? 'Active' : h('span', { class: 'badge text-bg-secondary' }, 'Inactive')),
    h('td', { class: 'text-end text-nowrap' },
      h('button', { class: 'btn btn-sm btn-outline-secondary me-2', type: 'button', onclick: () => openForm(s) }, 'Edit'),
      h('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => showPrices(s.SupplierId) }, 'Prices')))));
  empty.hidden = suppliers.length > 0;
}

function openForm(supplier) {
  editingId = supplier ? supplier.SupplierId : null;
  document.getElementById('form-title').textContent = supplier ? `Edit ${supplier.Name}` : 'Add supplier';
  field('f-name').value = supplier ? supplier.Name : '';
  field('f-contact').value = supplier ? supplier.ContactPerson || '' : '';
  field('f-phone').value = supplier ? supplier.Phone || '' : '';
  field('f-email').value = supplier ? supplier.Email || '' : '';
  field('f-address').value = supplier ? supplier.Address || '' : '';
  field('f-terms').value = supplier ? supplier.PaymentTerms || '' : '';
  field('f-lead').value = supplier ? supplier.LeadTimeDays : 0;
  field('f-active').checked = supplier ? Boolean(supplier.IsActive) : true;
  field('active-wrap').hidden = !supplier;
  showError(formError, '');
  form.hidden = false;
  field('f-name').focus();
}

function closeForm() {
  form.hidden = true;
  editingId = null;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(formError, '');
  const body = {
    name: field('f-name').value,
    contactPerson: field('f-contact').value,
    phone: field('f-phone').value,
    email: field('f-email').value,
    address: field('f-address').value,
    paymentTerms: field('f-terms').value,
    leadTimeDays: field('f-lead').value,
    isActive: field('f-active').checked,
  };
  try {
    const url = editingId ? `/api/purchasing/suppliers/${editingId}` : '/api/purchasing/suppliers';
    const method = editingId ? 'PUT' : 'POST';
    await api(url, { method, body });
    closeForm();
    await load();
  } catch (err) {
    showError(formError, err.message);
  }
});

function priceRow(supplierId, price) {
  const input = h('input', {
    class: 'form-control form-control-sm num', inputMode: 'decimal', autocomplete: 'off',
    value: price.UnitPriceCentavos == null ? '' : pesosPlain(price.UnitPriceCentavos),
    placeholder: 'No price yet', 'aria-label': `Price of ${price.Code}`,
  });
  const note = h('span', { class: 'hint ms-2' });

  async function save() {
    const centavos = toCentavos(input.value);
    if (centavos === null) {
      note.textContent = PRICE_ERROR;
      note.className = 'status-bad small ms-2';
      return;
    }
    try {
      await api(`/api/purchasing/suppliers/${supplierId}/prices/${price.ItemId}`, {
        method: 'PUT',
        body: { unitPriceCentavos: centavos },
      });
      input.value = pesosPlain(centavos);
      note.textContent = 'Saved';
      note.className = 'status-ok small ms-2';
      refreshCounts();
    } catch (err) {
      note.textContent = err.message;
      note.className = 'status-bad small ms-2';
    }
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      save();
    }
  });

  return h('tr', null,
    h('td', null, h('strong', null, price.Code)),
    h('td', null, price.Description),
    h('td', null, price.Unit),
    h('td', null, input),
    h('td', { class: 'text-nowrap' }, h('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: save }, 'Save'), note));
}

async function showPrices(supplierId) {
  showError(errorBox, '');
  try {
    const supplier = await api(`/api/purchasing/suppliers/${supplierId}`);
    pricedSupplierId = supplierId;
    document.getElementById('prices-title').textContent = `Prices from ${supplier.Name}`;
    priceRows.replaceChildren(...supplier.prices.map((p) => priceRow(supplierId, p)));
    pricesSection.hidden = false;
    pricesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function refreshCounts() {
  try {
    suppliers = await api('/api/purchasing/suppliers');
    render();
  } catch {
    // Leave current display if count refresh fails.
  }
}

async function load() {
  showError(errorBox, '');
  try {
    suppliers = await api('/api/purchasing/suppliers');
    render();
    if (pricedSupplierId && !suppliers.some((s) => s.SupplierId === pricedSupplierId)) {
      pricesSection.hidden = true;
    }
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  await startPage(['purchaser']);
  document.getElementById('add').addEventListener('click', () => openForm(null));
  document.getElementById('cancel').addEventListener('click', closeForm);
  await load();
}

start();
