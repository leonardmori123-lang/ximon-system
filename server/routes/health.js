// Open /api/health in the browser to prove the server can read the database.
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const users = db.get('SELECT COUNT(*) AS n FROM AppUser').n;
    res.json({ ok: true, database: 'SQLite (ximon.db)', users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
