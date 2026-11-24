// Routes for suppliers, purchase requisitions, and purchase orders.
const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const purchasing = require('../services/purchasing');

const router = express.Router();

// Suppliers and pricing (purchaser only).
router.get('/suppliers', requireRole(ROLES.PURCHASER), (req, res) => {
  res.json(purchasing.listSuppliers());
});

router.get('/suppliers/:id', requireRole(ROLES.PURCHASER), (req, res) => {
  res.json(purchasing.getSupplier(parseId(req.params.id)));
});

router.post('/suppliers', requireRole(ROLES.PURCHASER), (req, res) => {
  res.status(201).json(purchasing.createSupplier(req.body));
});

router.put('/suppliers/:id', requireRole(ROLES.PURCHASER), (req, res) => {
  res.json(purchasing.updateSupplier(parseId(req.params.id), req.body));
});

router.put('/suppliers/:id/prices/:itemId', requireRole(ROLES.PURCHASER), (req, res) => {
  const supplierId = parseId(req.params.id);
  const itemId = parseId(req.params.itemId, 'Bad item id.');
  const body = req.body || {};
  res.json(purchasing.saveSupplierPrice(supplierId, itemId, body.unitPriceCentavos));
});

// Purchase requisitions.
router.get('/prs', requireRole(ROLES.PURCHASER, ROLES.OWNER), (req, res) => {
  res.json(purchasing.listPrs(req.query.status));
});

router.get('/prs/:id', requireRole(ROLES.PURCHASER, ROLES.OWNER), (req, res) => {
  res.json(purchasing.getPr(req.session.user, parseId(req.params.id)));
});

router.put('/prs/:id/prices', requireRole(ROLES.PURCHASER), (req, res) => {
  res.json(purchasing.savePrices(req.session.user, parseId(req.params.id), req.body));
});

// Purchase requisition decisions by owner.
router.post('/prs/:id/approve', requireRole(ROLES.OWNER), (req, res) => {
  res.json(purchasing.decidePr(req.session.user, parseId(req.params.id), 'approve', req.body));
});

router.post('/prs/:id/hold', requireRole(ROLES.OWNER), (req, res) => {
  res.json(purchasing.decidePr(req.session.user, parseId(req.params.id), 'hold', req.body));
});

router.post('/prs/:id/cancel', requireRole(ROLES.OWNER), (req, res) => {
  res.json(purchasing.decidePr(req.session.user, parseId(req.params.id), 'cancel', req.body));
});

// Purchase orders.
router.post('/prs/:id/po', requireRole(ROLES.PURCHASER), (req, res) => {
  res.status(201).json(purchasing.createPo(req.session.user, parseId(req.params.id), req.body));
});

router.get('/pos', requireRole(ROLES.PURCHASER, ROLES.OWNER, ROLES.VERIFIER), (req, res) => {
  res.json(purchasing.listPos(req.session.user, req.query.status));
});

router.get('/pos/:id', requireRole(ROLES.PURCHASER, ROLES.OWNER, ROLES.VERIFIER), (req, res) => {
  res.json(purchasing.getPo(req.session.user, parseId(req.params.id)));
});

module.exports = router;
