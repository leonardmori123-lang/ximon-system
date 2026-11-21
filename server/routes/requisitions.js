const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const rf = require('../services/requisitions');

const router = express.Router();

// Foreman files and revises; owner reads everything and decides. Other roles come in later builds.
router.get('/', requireRole(ROLES.OWNER, ROLES.FOREMAN), (req, res) => {
  res.json(rf.listRequisitions(req.session.user, req.query.status));
});

router.get('/:id', requireRole(ROLES.OWNER, ROLES.FOREMAN), (req, res) => {
  res.json(rf.getRequisition(req.session.user, parseId(req.params.id)));
});

router.post('/', requireRole(ROLES.FOREMAN), (req, res) => {
  res.status(201).json(rf.createRequisition(req.session.user, req.body));
});

router.put('/:id', requireRole(ROLES.FOREMAN), (req, res) => {
  res.json(rf.reviseRequisition(req.session.user, parseId(req.params.id), req.body));
});

router.post('/:id/approve', requireRole(ROLES.OWNER), (req, res) => {
  res.json(rf.approveRequisition(req.session.user, parseId(req.params.id)));
});

router.post('/:id/return', requireRole(ROLES.OWNER), (req, res) => {
  res.json(rf.returnRequisition(req.session.user, parseId(req.params.id), (req.body || {}).reason));
});

router.post('/:id/cancel', requireRole(ROLES.FOREMAN), (req, res) => {
  res.json(rf.cancelRequisition(req.session.user, parseId(req.params.id), (req.body || {}).reason));
});

// The owner cancels an approved requisition; what was reserved for it is released.
router.post('/:id/cancel-approved', requireRole(ROLES.OWNER), (req, res) => {
  res.json(rf.cancelApprovedRequisition(req.session.user, parseId(req.params.id), (req.body || {}).reason));
});

module.exports = router;
