// Each screen a role may open. When a module builds a screen, set its href.
const ROLE_SCREENS = {
  owner: [
    { label: 'Approve or return requisitions', href: '/requisitions.html' },
    { label: 'Approve purchase requisitions', href: '/prs.html' },
    { label: 'Purchase orders', href: '/pos.html' },
    { label: 'Item list', href: '/items.html' },
    { label: 'Issuance slips', href: '/slips.html' },
    { label: 'Reports', href: null },
  ],
  foreman: [
    { label: 'File a requisition', href: '/rf-form.html' },
    { label: 'My requisitions', href: '/requisitions.html' },
    { label: 'Confirm issued items', href: '/slips.html' },
  ],
  custodian: [
    { label: 'Item list and stock', href: '/items.html' },
    { label: 'Release items on the issuance slip', href: '/slips.html' },
    { label: 'Reorder points', href: '/items.html' },
  ],
  purchaser: [
    { label: 'Suppliers', href: '/suppliers.html' },
    { label: 'Purchase requisitions', href: '/prs.html' },
    { label: 'Purchase orders', href: '/pos.html' },
    { label: 'Late and outstanding deliveries', href: null },
  ],
  verifier: [
    { label: 'Open purchase orders', href: '/pos.html' },
    { label: 'Receive a delivery', href: null },
  ],
};

function screenRow(screen) {
  const row = h(screen.href ? 'a' : 'div', { class: 'screen-item', href: screen.href }, h('span', null, screen.label));
  if (!screen.href) row.append(h('span', { class: 'note' }, 'Not built yet'));
  return row;
}

async function start() {
  const user = await startPage();
  document.getElementById('screens').append(...(ROLE_SCREENS[user.role] || []).map(screenRow));

  const health = document.getElementById('health');
  try {
    const data = await fetch('/api/health').then((res) => res.json());
    health.textContent = data.ok ? `Database connected: ${data.database}` : `Database problem: ${data.error}`;
    health.className = `small mb-0 ${data.ok ? 'status-ok' : 'status-bad'}`;
  } catch {
    health.textContent = 'Cannot reach the server.';
    health.className = 'small mb-0 status-bad';
  }
}

start();
