// Shared by every page after login: API calls, the top bar, small helpers.
const ROLE_NAMES = {
  owner: 'Owner or manager',
  foreman: 'Foreman or project in charge',
  custodian: 'Warehouse custodian',
  purchaser: 'Purchaser',
  verifier: 'Delivery verifier',
};

const STATUS_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved',
  returned: 'Returned',
  cancelled: 'Cancelled',
  partly_fulfilled: 'Partly fulfilled',
  fulfilled: 'Fulfilled',
};
const STATUS_CLASSES = {
  pending: 'text-bg-warning',
  approved: 'text-bg-success',
  returned: 'text-bg-info',
  cancelled: 'text-bg-secondary',
  partly_fulfilled: 'text-bg-primary',
  fulfilled: 'text-bg-success',
};

// Builds an element without innerHTML, so text from the database can never run as code.
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/';
    throw new Error('Please log in.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
  return data;
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
}

// Call first on every page. Sends the person back if their role may not open the page.
async function startPage(allowedRoles) {
  const user = await api('/api/me');
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    location.href = '/app.html';
    return new Promise(() => {});
  }
  const bar = document.getElementById('topbar');
  bar.className = 'brandbar';
  bar.replaceChildren(
    h('div', { class: 'container d-flex justify-content-between align-items-center py-2' },
      h('div', null,
        h('a', { href: '/app.html', class: 'text-white text-decoration-none fw-semibold' }, 'Ximon'),
        h('span', { class: 'muted ms-2 small' }, `${user.fullName}, ${ROLE_NAMES[user.role] || user.role}`)),
      h('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: logout }, 'Log out'))
  );
  return user;
}

function statusBadge(status) {
  return h('span', { class: `badge ${STATUS_CLASSES[status] || 'text-bg-light'}` }, STATUS_LABELS[status] || status);
}

function qty(n) {
  return Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });
}

function sentence(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function showError(box, message) {
  box.textContent = message;
  box.hidden = !message;
}
