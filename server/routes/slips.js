// Routes for issuance slips and warehouse handoff.
const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const issuance = require('../services/issuance');

const router = express.Router();
const READERS = [ROLES.OWNER, ROLES.CUSTODIAN, ROLES.FOREMAN];

// Placed before /:id so releasable is not matched as an id.
router.get('/releasable', requireRole(ROLES.CUSTODIAN), (req, res) => {
  res.json(issuance.listReleasable());
});

router.get('/', requireRole(...READERS), (req, res) => {
  res.json(issuance.listSlips(req.session.user, req.query.status));
});

router.get('/:id', requireRole(...READERS), (req, res) => {
  res.json(issuance.getSlip(req.session.user, parseId(req.params.id)));
});

router.post('/', requireRole(ROLES.CUSTODIAN), (req, res) => {
  const body = req.body || {};
  const requisitionId = parseId(body.requisitionId, 'Choose a requisition.');
  res.status(201).json(issuance.prepareSlip(req.session.user, requisitionId));
});

router.post('/:id/release', requireRole(ROLES.CUSTODIAN), (req, res) => {
  res.json(issuance.releaseSlip(req.session.user, parseId(req.params.id)));
});

router.post('/:id/cancel', requireRole(ROLES.CUSTODIAN), (req, res) => {
  res.json(issuance.cancelSlip(req.session.user, parseId(req.params.id)));
});

router.post('/:id/acknowledge', requireRole(ROLES.FOREMAN), (req, res) => {
  const body = req.body || {};
  res.json(issuance.acknowledgeSlip(req.session.user, parseId(req.params.id), body.remarks));
});

module.exports = router;
