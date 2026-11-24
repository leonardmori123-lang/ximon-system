// Routes for user notifications and unread counters.
const express = require('express');
const { requireLogin } = require('../auth');
const { parseId } = require('../services/errors');
const notes = require('../services/notifications');

const router = express.Router();

router.get('/count', requireLogin, (req, res) => {
  res.json({ unread: notes.unreadCount(req.session.user.id) });
});

router.get('/', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  res.json({ unread: notes.unreadCount(userId), items: notes.listFor(userId) });
});

router.post('/read-all', requireLogin, (req, res) => {
  res.json(notes.markAllRead(req.session.user.id));
});

router.post('/:id/read', requireLogin, (req, res) => {
  notes.markRead(req.session.user.id, parseId(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
