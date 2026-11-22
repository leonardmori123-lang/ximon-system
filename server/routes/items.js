const express = require('express');
const { ROLES, requireLogin, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const { listItems, createItem, updateItem } = require('../services/items');
const { adjustStock } = require('../services/adjustments');

const router = express.Router();
const EDITORS = [ROLES.OWNER, ROLES.CUSTODIAN];

// Everyone logged in can read the list. Editors also see inactive items with ?all=1.
router.get('/', requireLogin, (req, res) => {
  const includeInactive = req.query.all === '1' && EDITORS.includes(req.session.user.role);
  res.json(listItems({ includeInactive }));
});

router.post('/', requireRole(...EDITORS), (req, res) => {
  res.status(201).json(createItem(req.body));
});

router.put('/:id', requireRole(...EDITORS), (req, res) => {
  res.json(updateItem(parseId(req.params.id), req.body));
});

// The custodian fixes a wrong count. Body: { counted, reason }.
router.post('/:id/adjust', requireRole(ROLES.CUSTODIAN), (req, res) => {
  const { counted, reason } = req.body || {};
  res.json(adjustStock({ itemId: parseId(req.params.id), counted, reason, userId: req.session.user.id }));
});

module.exports = router;
