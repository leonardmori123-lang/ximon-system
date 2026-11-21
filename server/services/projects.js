// Projects: the owner adds them and sets the material budget. Everyone logged in can list the active ones
// (routes/projects.js, no money); only the owner gets the budget and what it is already promised to.
const db = require('../db');
const { HttpError } = require('./errors');
const { validateProjectInput } = require('./projectRules');
const { budgetCheck } = require('./purchasingRules');
const { committedCentavos } = require('./purchasing');

// Every project, active ones first, with the budget, what it is already promised to (POs made and approved
// PRs waiting for their PO, the same sum the PR page uses) and what is left. Left is null when no budget is set.
function listProjects() {
  const projects = db.all(
    `SELECT ProjectId, Code, Name, Status, MaterialBudgetCentavos
     FROM Project ORDER BY CASE Status WHEN 'active' THEN 0 ELSE 1 END, Code`
  );
  return projects.map((p) => {
    const promised = committedCentavos(p.ProjectId);
    const check = budgetCheck(p.MaterialBudgetCentavos, promised, null);
    return { ...p, PromisedCentavos: promised, LeftCentavos: check.budgetSet ? check.remainingCentavos : null };
  });
}

function createProject(body) {
  const project = validateProjectInput(body, { creating: true });
  try {
    const { lastId } = db.run(
      `INSERT INTO Project (Code, Name, MaterialBudgetCentavos, Status) VALUES (@code, @name, @budget, @status)`,
      { code: project.code, name: project.name, budget: project.materialBudgetCentavos, status: project.status }
    );
    return { id: lastId };
  } catch (err) {
    if (db.isUniqueError(err)) throw new HttpError(409, 'That project code is already used.');
    throw err;
  }
}

// The code never changes: documents already refer to it.
function updateProject(id, body) {
  const project = validateProjectInput(body, { creating: false });
  const { changes } = db.run(
    `UPDATE Project SET Name = @name, MaterialBudgetCentavos = @budget, Status = @status WHERE ProjectId = @id`,
    { id, name: project.name, budget: project.materialBudgetCentavos, status: project.status }
  );
  if (changes === 0) throw new HttpError(404, 'Project not found.');
  return { id };
}

module.exports = { listProjects, createProject, updateProject };
