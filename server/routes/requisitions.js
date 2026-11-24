// Routes for material requisition forms.
const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const rf = require('../services/requisitions');

const router = express.Router();

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
  const body = req.body || {};
  res.json(rf.returnRequisition(req.session.user, parseId(req.params.id), body.reason));
});

router.post('/:id/cancel', requireRole(ROLES.FOREMAN), (req, res) => {
  const body = req.body || {};
  res.json(rf.cancelRequisition(req.session.user, parseId(req.params.id), body.reason));
});

// Owner cancels an approved requisition and releases reserved stock.
router.post('/:id/cancel-approved', requireRole(ROLES.OWNER), (req, res) => {
  const body = req.body || {};
  res.json(rf.cancelApprovedRequisition(req.session.user, parseId(req.params.id), body.reason));
});

module.exports = router;
