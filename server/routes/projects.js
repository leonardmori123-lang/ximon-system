const express = require('express');
const { requireLogin } = require('../auth');
const { query } = require('../db');

const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
  res.json(await query(`SELECT ProjectId, Code, Name FROM dbo.Project WHERE Status = 'active' ORDER BY Code`));
});

module.exports = router;
