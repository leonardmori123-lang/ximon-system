const rows = document.getElementById('rows');
const search = document.getElementById('search');
const empty = document.getElementById('empty');
const form = document.getElementById('item-form');
const formError = document.getElementById('form-error');
const modal = new bootstrap.Modal(document.getElementById('item-modal'));
const field = (id) => document.getElementById(id);

let items = [];
let canEdit = false;
let editingId = null;

function render() {
  const text = search.value.trim().toLowerCase();
  const shown = items.filter((i) => `${i.Code} ${i.Description} ${i.Location || ''}`.toLowerCase().includes(text));
  rows.replaceChildren(...shown.map((i) => {
    const row = h('tr', { class: i.IsActive ? '' : 'text-muted' },
      h('td', null, h('strong', null, i.Code), i.IsTool ? h('span', { class: 'badge text-bg-light ms-2' }, 'tool') : null,
        i.IsActive ? null : h('span', { class: 'badge text-bg-secondary ms-2' }, 'inactive')),
      h('td', null, i.Description),
      h('td', null, i.Unit),
      h('td', null, i.Location || ''),
      h('td', { class: 'num' }, qty(i.OnHand)),
      h('td', { class: 'num' }, qty(i.Reserved)),
      h('td', { class: 'num' }, qty(i.Available)),
      h('td', { class: 'num' }, qty(i.ReorderPoint)),
      h('td', { class: 'num' }, i.LeadTimeDays),
      h('td', { class: 'text-end' }, canEdit
        ? h('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => openForm(i) }, 'Edit')
        : null));
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

async function load() {
  items = await api(canEdit ? '/api/items?all=1' : '/api/items');
  render();
}

async function start() {
  const user = await startPage();
  canEdit = user.role === 'owner' || user.role === 'custodian';
  const add = document.getElementById('add');
  add.hidden = !canEdit;
  add.addEventListener('click', () => openForm(null));
  search.addEventListener('input', render);
  await load();
}

start();
