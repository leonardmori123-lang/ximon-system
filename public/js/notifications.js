// Notifications page listing user alerts and mark-as-read actions.
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const errorBox = document.getElementById('error');
const markAll = document.getElementById('mark-all');

async function openNotification(n) {
  try {
    if (!n.IsRead) {
      await api(`/api/notifications/${n.NotificationId}/read`, { method: 'POST' });
    }
  } catch {
    // Continue navigation even if marking as read fails.
  }
  if (n.LinkUrl) {
    location.href = n.LinkUrl;
  } else {
    await load();
    refreshBell();
  }
}

function row(n) {
  return h('a', {
    class: `screen-item ${n.IsRead ? '' : 'note-unread'}`,
    href: n.LinkUrl || '#',
    onclick: (event) => {
      event.preventDefault();
      openNotification(n);
    },
  },
  h('span', { class: n.IsRead ? '' : 'fw-semibold' }, n.Message),
  h('span', { class: 'note text-nowrap' }, n.CreatedAt));
}

async function load() {
  showError(errorBox, '');
  try {
    const data = await api('/api/notifications');
    list.replaceChildren(...data.items.map(row));
    list.hidden = data.items.length === 0;
    empty.hidden = data.items.length > 0;
    markAll.disabled = data.unread === 0;
  } catch (err) {
    showError(errorBox, err.message);
  }
}

markAll.addEventListener('click', async () => {
  await api('/api/notifications/read-all', { method: 'POST' });
  await load();
  refreshBell();
});

async function start() {
  await startPage();
  await load();
}

start();
