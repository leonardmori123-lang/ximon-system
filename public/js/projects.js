// Construction project management and material budget tracking.
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const form = document.getElementById('project-form');
const formError = document.getElementById('form-error');
const modal = new bootstrap.Modal(document.getElementById('project-modal'));

function field(id) {
  return document.getElementById(id);
}

let editingId = null;
let editingCode = '';

function leftCell(p) {
  if (p.LeftCentavos === null) {
    return h('td', { class: 'num text-muted' }, '-');
  }
  if (p.LeftCentavos < 0) {
    return h('td', { class: 'num status-bad' }, pesos(p.LeftCentavos), h('span', { class: 'badge text-bg-danger ms-2' }, 'Over'));
  }
  return h('td', { class: 'num' }, pesos(p.LeftCentavos));
}

function render(projects) {
  rows.replaceChildren(...projects.map((p) => h('tr', { class: p.Status === 'active' ? '' : 'text-muted' },
    h('td', null, h('strong', null, p.Code)),
    h('td', null, p.Name),
    h('td', null, p.Status === 'active'
      ? h('span', { class: 'badge text-bg-success' }, 'Active')
      : h('span', { class: 'badge text-bg-secondary' }, 'Closed')),
    p.MaterialBudgetCentavos > 0 ? h('td', { class: 'num' }, pesos(p.MaterialBudgetCentavos)) : h('td', { class: 'num text-muted' }, 'Not set'),
    h('td', { class: 'num' }, pesos(p.PromisedCentavos)),
    leftCell(p),
    h('td', { class: 'text-end' },
      h('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => openForm(p) }, 'Edit')))));
  empty.hidden = projects.length > 0;
}

function openForm(project) {
  editingId = project ? project.ProjectId : null;
  editingCode = project ? project.Code : '';
  document.getElementById('modal-title').textContent = project ? `Edit ${project.Code}` : 'Add project';
  field('f-code').value = project ? project.Code : '';
  field('f-code').disabled = Boolean(project);
  field('f-name').value = project ? project.Name : '';
  field('f-budget').value = project && project.MaterialBudgetCentavos > 0 ? pesosPlain(project.MaterialBudgetCentavos) : '';
  field('f-status').value = project ? project.Status : 'active';
  field('status-wrap').hidden = !project;
  field('delete').hidden = !project;
  showError(formError, '');
  modal.show();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(formError, '');
  const budget = toBudgetCentavos(field('f-budget').value);
  if (budget === null) {
    showError(formError, 'Enter the material budget in pesos with at most 2 decimals, or leave it empty.');
    return;
  }
  const body = { name: field('f-name').value, materialBudgetCentavos: budget };
  if (editingId) {
    body.status = field('f-status').value;
  } else {
    body.code = field('f-code').value;
  }
  try {
    const url = editingId ? `/api/projects/${editingId}` : '/api/projects';
    const method = editingId ? 'PUT' : 'POST';
    await api(url, { method, body });
    modal.hide();
    await load();
  } catch (err) {
    showError(formError, err.message);
  }
});

form.addEventListener('input', () => showError(formError, ''));

async function deleteProject() {
  if (!editingId) {
    return;
  }
  if (!window.confirm(`Delete ${editingCode} for good? This cannot be undone.`)) {
    return;
  }
  showError(formError, '');
  try {
    await api(`/api/projects/${editingId}`, { method: 'DELETE' });
    modal.hide();
    await load();
  } catch (err) {
    showError(formError, err.message);
  }
}

async function load() {
  showError(errorBox, '');
  try {
    render(await api('/api/projects/all'));
  } catch (err) {
    showError(errorBox, err.message);
  }
}

async function start() {
  await startPage(['owner']);
  document.getElementById('add').addEventListener('click', () => openForm(null));
  field('delete').addEventListener('click', deleteProject);
  await load();
}

start();
