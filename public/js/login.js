// User login page handling authentication requests.
const form = document.getElementById('login-form');
const errorBox = document.getElementById('error');

fetch('/api/me').then((res) => {
  if (res.ok) {
    location.href = '/app.html';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    if (res.ok) {
      location.href = '/app.html';
      return;
    }
    const data = await res.json();
    errorBox.textContent = data.error || 'Could not log in.';
  } catch {
    errorBox.textContent = 'Cannot reach the server. Check the Wi-Fi and the address.';
  }
  errorBox.hidden = false;
});
