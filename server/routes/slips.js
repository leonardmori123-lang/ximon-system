const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { HttpError } = require('../services/errors');
const issuance = require('../services/issuance');

const router = express.Router();
const READERS = [ROLES.OWNER, ROLES.CUSTODIAN, ROLES.FOREMAN];

function idParam(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad id.');
  return id;
}

// Must stay above '/:id', or "releasable" would be read as a slip id.
router.get('/releasable', requireRole(ROLES.CUSTODIAN), async (req, res) => {
  res.json(await issuance.listReleasable());
});

router.get('/', requireRole(...READERS), async (req, res) => {
  res.json(await issuance.listSlips(req.session.user, req.query.status));
});

router.get('/:id', requireRole(...READERS), async (req, res) => {
  res.json(await issuance.getSlip(req.session.user, idParam(req)));
});

router.post('/', requireRole(ROLES.CUSTODIAN), async (req, res) => {
  const requisitionId = Number.parseInt((req.body || {}).requisitionId, 10);
  if (!Number.isInteger(requisitionId) || requisitionId <= 0) throw new HttpError(400, 'Choose a requisition.');
  res.status(201).json(await issuance.prepareSlip(req.session.user, requisitionId));
});

router.post('/:id/release', requireRole(ROLES.CUSTODIAN), async (req, res) => {
  res.json(await issuance.releaseSlip(req.session.user, idParam(req)));
});

router.post('/:id/cancel', requireRole(ROLES.CUSTODIAN), async (req, res) => {
  res.json(await issuance.cancelSlip(req.session.user, idParam(req)));
});

router.post('/:id/acknowledge', requireRole(ROLES.FOREMAN), async (req, res) => {
  res.json(await issuance.acknowledgeSlip(req.session.user, idParam(req), (req.body || {}).remarks));
});

module.exports = router;
