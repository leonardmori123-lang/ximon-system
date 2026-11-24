// Routes for inventory item management and stock adjustments.
const express = require('express');
const { ROLES, requireLogin, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const { listItems, createItem, updateItem } = require('../services/items');
const { adjustStock } = require('../services/adjustments');

const router = express.Router();
const EDITORS = [ROLES.OWNER, ROLES.CUSTODIAN];

router.get('/', requireLogin, (req, res) => {
  const isEditor = EDITORS.includes(req.session.user.role);
  const includeInactive = req.query.all === '1' && isEditor;
  res.json(listItems({ includeInactive }));
});

router.post('/', requireRole(...EDITORS), (req, res) => {
  res.status(201).json(createItem(req.body));
});

router.put('/:id', requireRole(...EDITORS), (req, res) => {
  res.json(updateItem(parseId(req.params.id), req.body));
});

router.post('/:id/adjust', requireRole(ROLES.CUSTODIAN), (req, res) => {
  const body = req.body || {};
  res.json(adjustStock({
    itemId: parseId(req.params.id),
    counted: body.counted,
    reason: body.reason,
    userId: req.session.user.id,
  }));
});

module.exports = router;
