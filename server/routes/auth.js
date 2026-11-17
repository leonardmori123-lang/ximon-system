const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  const user = db.get(
    'SELECT UserId, FullName, PasswordHash, Role FROM AppUser WHERE Username = @username AND IsActive = 1',
    { username: String(username).trim() }
  );
  const ok = user && (await bcrypt.compare(String(password), user.PasswordHash));
  if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.user = { id: user.UserId, fullName: user.FullName, role: user.Role };
    res.json(req.session.user);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json(req.session.user);
});

module.exports = router;
