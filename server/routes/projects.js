const express = require('express');
const { ROLES, requireLogin, requireRole } = require('../auth');
const { parseId } = require('../services/errors');
const projects = require('../services/projects');
const db = require('../db');

const router = express.Router();

// Everyone logged in: the active projects for the pick lists. No money here.
router.get('/', requireLogin, (req, res) => {
  res.json(db.all(`SELECT ProjectId, Code, Name FROM Project WHERE Status = 'active' ORDER BY Code`));
});

// The owner manages projects and their material budget.
router.get('/all', requireRole(ROLES.OWNER), (req, res) => {
  res.json(projects.listProjects());
});

router.post('/', requireRole(ROLES.OWNER), (req, res) => {
  res.status(201).json(projects.createProject(req.body));
});

router.put('/:id', requireRole(ROLES.OWNER), (req, res) => {
  res.json(projects.updateProject(parseId(req.params.id), req.body));
});

module.exports = router;
