const rows = document.getElementById('rows');
const search = document.getElementById('search');
const empty = document.getElementById('empty');
const form = document.getElementById('item-form');
const formError = document.getElementById('form-error');
const modal = new bootstrap.Modal(document.getElementById('item-modal'));
const lowOnly = document.getElementById('low-only');
const adjustForm = document.getElementById('adjust-form');
const adjustError = document.getElementById('adjust-error');
const adjustModal = new bootstrap.Modal(document.getElementById('adjust-modal'));
const field = (id) => document.getElementById(id);

let items = [];
let canEdit = false;
let canAdjust = false;
let editingId = null;
let adjustingId = null;

function render() {
  const text = search.value.trim().toLowerCase();
  const shown = items.filter((i) => `${i.Code} ${i.Description} ${i.Location || ''}`.toLowerCase().includes(text)
    && (!lowOnly.checked || i.IsLow));
  rows.replaceChildren(...shown.map((i) => {
    const row = h('tr', { class: i.IsActive ? '' : 'text-muted' },
      h('td', null, h('strong', null, i.Code), i.IsTool ? h('span', { class: 'badge text-bg-light ms-2' }, 'tool') : null,
        i.IsActive ? null : h('span', { class: 'badge text-bg-secondary ms-2' }, 'inactive'),
        i.IsLow ? h('span', { class: 'badge text-bg-danger ms-2' }, 'Low') : null),
      h('td', null, i.Description),
      h('td', null, i.Unit),
      h('td', null, i.Location || ''),
      h('td', { class: 'num' }, qty(i.OnHand)),
      h('td', { class: 'num' }, qty(i.Reserved)),
      h('td', { class: 'num' }, qty(i.Available)),
      h('td', { class: 'num' }, qty(i.ReorderPoint)),
      h('td', { class: 'num' }, i.LeadTimeDays),
      h('td', { class: 'text-end text-nowrap' },
        canEdit ? h('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => openForm(i) }, 'Edit') : null,
        canAdjust ? h('button', { class: 'btn btn-sm btn-outline-secondary ms-1', type: 'button', onclick: () => openAdjust(i) }, 'Adjust') : null));
    return row;
  }));
  empty.hidden = shown.length > 0;
}

function openForm(item) {
  editingId = item ? item.ItemId : null;
  document.getElementById('modal-title').textContent = item ? `Edit ${item.Code}` : 'Add item';
  field('f-code').value = item ? item.Code : '';
  field('f-code').disabled = Boolean(item); // the code never changes once documents use it
  field('f-description').value = item ? item.Description : '';
  field('f-unit').value = item ? item.Unit : '';
  field('f-location').value = item ? item.Location || '' : '';
  field('f-reorder').value = item ? item.ReorderPoint : 0;
  field('f-lead').value = item ? item.LeadTimeDays : 0;
  field('f-tool').checked = item ? Boolean(item.IsTool) : false;
  field('f-active').checked = item ? Boolean(item.IsActive) : true;
  field('active-wrap').hidden = !item;
  showError(formError, '');
  modal.show();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(formError, '');
  const body = {
    code: field('f-code').value,
    description: field('f-description').value,
    unit: field('f-unit').value,
    location: field('f-location').value,
    reorderPoint: field('f-reorder').value,
    leadTimeDays: field('f-lead').value,
    isTool: field('f-tool').checked,
    isActive: field('f-active').checked,
  };
  try {
    await api(editingId ? `/api/items/${editingId}` : '/api/items', { method: editingId ? 'PUT' : 'POST', body });
    modal.hide();
    await load();
  } catch (err) {
    showError(formError, err.message);
  }
});

// The custodian fixes a wrong count: he types what he counted, and the server works out the difference.
function openAdjust(item) {
  adjustingId = item.ItemId;
  document.getElementById('adjust-code').textContent = item.Code;
  document.getElementById('adjust-description').textContent = item.Description;
  document.getElementById('adjust-current').textContent = `${qty(item.OnHand)} ${item.Unit}`;
  document.getElementById('adjust-reserved').textContent = `${qty(item.Reserved)} ${item.Unit}`;
  field('a-counted').value = '';
  field('a-reason').value = '';
  showError(adjustError, '');
  adjustModal.show();
}

adjustForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(adjustError, '');
  const counted = field('a-counted').value;
  if (counted.trim() === '') { // an empty box must not be read as a count of zero
    showError(adjustError, 'Enter the counted quantity.');
    return;
  }
  try {
    await api(`/api/items/${adjustingId}/adjust`, { method: 'POST', body: { counted: Number(counted), reason: field('a-reason').value } });
    adjustModal.hide();
    await load();
  } catch (err) {
    showError(adjustError, err.message);
  }
});

async function load() {
  items = await api(canEdit ? '/api/items?all=1' : '/api/items');
  render();
}

async function start() {
  const user = await startPage();
  canEdit = user.role === 'owner' || user.role === 'custodian';
  canAdjust = user.role === 'custodian';
  const add = document.getElementById('add');
  add.hidden = !canEdit;
  add.addEventListener('click', () => openForm(null));
  search.addEventListener('input', render);
  lowOnly.addEventListener('change', render);
  await load();
}

start();
