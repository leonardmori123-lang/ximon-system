const ROLE_NAMES = {
  owner: 'Owner or manager',
  foreman: 'Foreman or project in charge',
  custodian: 'Warehouse custodian',
  purchaser: 'Purchaser',
  verifier: 'Delivery verifier',
};

// Each screen a role may open. When a module builds a screen, set its href.
const ROLE_SCREENS = {
  owner: [
    { label: 'Approve or return requisitions', href: null },
    { label: 'Approve purchase requisitions', href: null },
    { label: 'Reports', href: null },
  ],
  foreman: [
    { label: 'File a requisition', href: null },
    { label: 'My requisitions', href: null },
    { label: 'Confirm issued items', href: null },
  ],
  custodian: [
    { label: 'Item list and stock', href: null },
    { label: 'Release items on the issuance slip', href: null },
    { label: 'Reorder points', href: null },
  ],
  purchaser: [
    { label: 'Suppliers', href: null },
    { label: 'Purchase requisitions', href: null },
    { label: 'Purchase orders', href: null },
    { label: 'Late and outstanding deliveries', href: null },
  ],
  verifier: [
    { label: 'Open purchase orders', href: null },
    { label: 'Receive a delivery', href: null },
  ],
};

function screenRow(screen) {
  const row = document.createElement(screen.href ? 'a' : 'div');
  row.className = 'screen-item';
  if (screen.href) row.href = screen.href;
  const label = document.createElement('span');
  label.textContent = screen.label;
  row.append(label);
  if (!screen.href) {
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = 'Not built yet';
    row.append(note);
  }
  return row;
}

async function start() {
  const me = await fetch('/api/me');
  if (!me.ok) {
    location.href = '/';
    return;
  }
  const user = await me.json();
  document.getElementById('who').textContent = `${user.fullName}, ${ROLE_NAMES[user.role] || user.role}`;
  document.getElementById('screens').append(...(ROLE_SCREENS[user.role] || []).map(screenRow));

  const health = document.getElementById('health');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    health.textContent = data.ok ? `Database connected: ${data.database}` : `Database problem: ${data.error}`;
    health.className = `small mb-0 ${data.ok ? 'status-ok' : 'status-bad'}`;
  } catch {
    health.textContent = 'Cannot reach the server.';
    health.className = 'small mb-0 status-bad';
  }
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
});

start();
