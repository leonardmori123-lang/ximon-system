// Material requisition form entry and revision.
const linesBox = document.getElementById('lines');
const errorBox = document.getElementById('error');
const form = document.getElementById('rf-form');
const editId = new URLSearchParams(location.search).get('id');
let items = [];

function lineRow(line = {}) {
  const select = h('select', { class: 'form-select', 'aria-label': 'Item' },
    h('option', { value: '' }, 'Choose an item'),
    ...items.map((i) => h('option', { value: String(i.ItemId), selected: i.ItemId === line.itemId },
      `${i.Code}, ${i.Description} (${i.Unit})`)));
  const quantity = h('input', { class: 'form-control', type: 'number', min: '0.01', step: 'any',
    'aria-label': 'Quantity', value: line.quantity ?? '' });
  const unit = h('span', { class: 'input-group-text', style: 'min-width: 3.5rem;' });
  function showUnit() {
    const item = items.find((i) => String(i.ItemId) === select.value);
    unit.textContent = item ? item.Unit : '';
  }
  select.addEventListener('change', showUnit);
  showUnit();
  const row = h('div', { class: 'row g-2 mb-2 line-row' },
    h('div', { class: 'col-md-7' }, select),
    h('div', { class: 'col-8 col-md-3' }, h('div', { class: 'input-group' }, quantity, unit)),
    h('div', { class: 'col-4 col-md-2' },
      h('button', { class: 'btn btn-outline-secondary w-100', type: 'button', onclick: () => {
        if (linesBox.children.length > 1) {
          row.remove();
        }
      } }, 'Remove')));
  row.select = select;
  row.quantity = quantity;
  return row;
}

function collect() {
  const validRows = [...linesBox.children].filter((row) => row.select.value || row.quantity.value);
  const lines = validRows.map((row) => ({
    itemId: Number(row.select.value),
    quantity: Number(row.quantity.value),
  }));
  return {
    projectId: Number(document.getElementById('project').value),
    dateNeeded: document.getElementById('date-needed').value,
    urgency: document.getElementById('urgency').value,
    purpose: document.getElementById('purpose').value,
    lines,
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(errorBox, '');
  try {
    const url = editId ? `/api/requisitions/${editId}` : '/api/requisitions';
    const method = editId ? 'PUT' : 'POST';
    const result = await api(url, { method, body: collect() });
    location.href = `/requisition.html?id=${editId || result.id}`;
  } catch (err) {
    showError(errorBox, err.message);
  }
});

async function fillFormForRevision() {
  document.getElementById('title').textContent = 'Revise requisition';
  document.getElementById('submit').textContent = 'Resubmit requisition';
  try {
    const rf = await api(`/api/requisitions/${encodeURIComponent(editId)}`);
    if (!rf.canRevise) {
      form.hidden = true;
      showError(errorBox, 'This requisition cannot be revised.');
      return;
    }
    document.getElementById('project').value = String(rf.ProjectId);
    document.getElementById('date-needed').value = rf.DateNeeded;
    document.getElementById('urgency').value = rf.Urgency;
    document.getElementById('purpose').value = rf.Purpose;
    linesBox.replaceChildren(...rf.lines.map((l) => lineRow({ itemId: l.ItemId, quantity: l.Quantity })));
    if (rf.DateNeeded < todayLocal()) {
      showError(errorBox, 'The old date needed has passed. Choose a new date.');
    }
  } catch (err) {
    form.hidden = true;
    showError(errorBox, err.message);
  }
}

async function start() {
  await startPage(['foreman']);
  const [projects, itemList] = await Promise.all([api('/api/projects'), api('/api/items')]);
  items = itemList;
  document.getElementById('project').replaceChildren(
    ...projects.map((p) => h('option', { value: String(p.ProjectId) }, `${p.Code}, ${p.Name}`)));
  document.getElementById('date-needed').min = todayLocal();
  document.getElementById('add-line').addEventListener('click', () => linesBox.append(lineRow()));

  if (editId) {
    await fillFormForRevision();
  } else {
    linesBox.append(lineRow());
  }
}

start();
