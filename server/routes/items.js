const express = require('express');
const { ROLES, requireLogin, requireRole } = require('../auth');
const { HttpError } = require('../services/errors');
const { listItems, createItem, updateItem } = require('../services/items');

const router = express.Router();
const EDITORS = [ROLES.OWNER, ROLES.CUSTODIAN];

function idParam(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad id.');
  return id;
}

// Everyone logged in can read the list. Editors also see inactive items with ?all=1.
router.get('/', requireLogin, async (req, res) => {
  const includeInactive = req.query.all === '1' && EDITORS.includes(req.session.user.role);
  res.json(await listItems({ includeInactive }));
});

router.post('/', requireRole(...EDITORS), async (req, res) => {
  res.status(201).json(await createItem(req.body));
});

router.put('/:id', requireRole(...EDITORS), async (req, res) => {
  res.json(await updateItem(idParam(req), req.body));
});

module.exports = router;
