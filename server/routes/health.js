// Open /api/health in the browser to prove Node can reach SQL Server.
const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT DB_NAME() AS db, SYSDATETIME() AS now');
    res.json({ ok: true, database: rows[0].db, time: rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
