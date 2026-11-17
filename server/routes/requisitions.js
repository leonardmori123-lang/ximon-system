const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { HttpError } = require('../services/errors');
const rf = require('../services/requisitions');

const router = express.Router();

function idParam(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad id.');
  return id;
}

// Foreman files and revises; owner reads everything and decides. Other roles come in later builds.
router.get('/', requireRole(ROLES.OWNER, ROLES.FOREMAN), async (req, res) => {
  res.json(await rf.listRequisitions(req.session.user, req.query.status));
});

router.get('/:id', requireRole(ROLES.OWNER, ROLES.FOREMAN), async (req, res) => {
  res.json(await rf.getRequisition(req.session.user, idParam(req)));
});

router.post('/', requireRole(ROLES.FOREMAN), async (req, res) => {
  res.status(201).json(await rf.createRequisition(req.session.user, req.body));
});

router.put('/:id', requireRole(ROLES.FOREMAN), async (req, res) => {
  res.json(await rf.reviseRequisition(req.session.user, idParam(req), req.body));
});

router.post('/:id/approve', requireRole(ROLES.OWNER), async (req, res) => {
  res.json(await rf.approveRequisition(req.session.user, idParam(req)));
});

router.post('/:id/return', requireRole(ROLES.OWNER), async (req, res) => {
  res.json(await rf.returnRequisition(req.session.user, idParam(req), (req.body || {}).reason));
});

router.post('/:id/cancel', requireRole(ROLES.FOREMAN), async (req, res) => {
  res.json(await rf.cancelRequisition(req.session.user, idParam(req), (req.body || {}).reason));
});

module.exports = router;
