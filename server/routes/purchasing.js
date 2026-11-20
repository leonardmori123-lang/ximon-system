const express = require('express');
const { ROLES, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const purchasing = require('../services/purchasing');

const router = express.Router();

// Suppliers and their prices: purchaser only.
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
  res.json(purchasing.saveSupplierPrice(supplierId, itemId, (req.body || {}).unitPriceCentavos));
});

// Purchase requisitions: the purchaser prices them, the owner reads them and decides.
router.get('/prs', requireRole(ROLES.PURCHASER, ROLES.OWNER), (req, res) => {
  res.json(purchasing.listPrs(req.query.status));
});

router.get('/prs/:id', requireRole(ROLES.PURCHASER, ROLES.OWNER), (req, res) => {
  res.json(purchasing.getPr(req.session.user, parseId(req.params.id)));
});

router.put('/prs/:id/prices', requireRole(ROLES.PURCHASER), (req, res) => {
  res.json(purchasing.savePrices(req.session.user, parseId(req.params.id), req.body));
});

// The owner's decisions. Hold and cancel take { reason }.
router.post('/prs/:id/approve', requireRole(ROLES.OWNER), (req, res) => {
  res.json(purchasing.decidePr(req.session.user, parseId(req.params.id), 'approve', req.body));
});

router.post('/prs/:id/hold', requireRole(ROLES.OWNER), (req, res) => {
  res.json(purchasing.decidePr(req.session.user, parseId(req.params.id), 'hold', req.body));
});

router.post('/prs/:id/cancel', requireRole(ROLES.OWNER), (req, res) => {
  res.json(purchasing.decidePr(req.session.user, parseId(req.params.id), 'cancel', req.body));
});

// The purchaser makes the purchase order from an approved PR.
router.post('/prs/:id/po', requireRole(ROLES.PURCHASER), (req, res) => {
  res.status(201).json(purchasing.createPo(req.session.user, parseId(req.params.id), req.body));
});

// Purchase orders: the purchaser and the owner read them. (The delivery verifier will get access when receiving is built.)
router.get('/pos', requireRole(ROLES.PURCHASER, ROLES.OWNER), (req, res) => {
  res.json(purchasing.listPos(req.query.status));
});

router.get('/pos/:id', requireRole(ROLES.PURCHASER, ROLES.OWNER), (req, res) => {
  res.json(purchasing.getPo(parseId(req.params.id)));
});

module.exports = router;
