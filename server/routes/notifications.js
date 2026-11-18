const express = require('express');
const { requireLogin } = require('../auth');
const { HttpError } = require('../services/errors');
const notes = require('../services/notifications');

const router = express.Router();

// A light call the top bar makes every 30 seconds.
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
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad id.');
  notes.markRead(req.session.user.id, id);
  res.json({ ok: true });
});

module.exports = router;
