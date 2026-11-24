// Routes for construction project records and budgets.
const express = require('express');
const { ROLES, requireLogin, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const projects = require('../services/projects');
const db = require('../db');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  res.json(db.all(`SELECT ProjectId, Code, Name FROM Project WHERE Status = 'active' ORDER BY Code`));
});

router.get('/all', requireRole(ROLES.OWNER), (req, res) => {
  res.json(projects.listProjects());
});

router.post('/', requireRole(ROLES.OWNER), (req, res) => {
  res.status(201).json(projects.createProject(req.body));
});

router.put('/:id', requireRole(ROLES.OWNER), (req, res) => {
  res.json(projects.updateProject(parseId(req.params.id), req.body));
});

router.delete('/:id', requireRole(ROLES.OWNER), (req, res) => {
  res.json(projects.deleteProject(parseId(req.params.id)));
});

module.exports = router;
