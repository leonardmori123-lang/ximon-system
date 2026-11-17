const express = require('express');
const { requireLogin } = require('../auth');
const db = require('../db');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  res.json(db.all(`SELECT ProjectId, Code, Name FROM Project WHERE Status = 'active' ORDER BY Code`));
});

module.exports = router;
