// Construction project records and budget management.
const db = require('../db');
const { HttpError } = require('./errors');
const { validateProjectInput } = require('./projectRules');
const { budgetCheck } = require('./purchasingRules');
const { committedCentavos } = require('./purchasing');

function listProjects() {
  const projects = db.all(
    `SELECT ProjectId, Code, Name, Status, MaterialBudgetCentavos
     FROM Project ORDER BY CASE Status WHEN 'active' THEN 0 ELSE 1 END, Code`
  );
  const result = [];
  for (const p of projects) {
    const promised = committedCentavos(p.ProjectId);
    const check = budgetCheck(p.MaterialBudgetCentavos, promised, null);
    let left = null;
    if (check.budgetSet) {
      left = check.remainingCentavos;
    }
    result.push({
      ...p,
      PromisedCentavos: promised,
      LeftCentavos: left,
    });
  }
  return result;
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
    if (db.isUniqueError(err)) {
      throw new HttpError(409, 'That project code is already used.');
    }
    throw err;
  }
}

function updateProject(id, body) {
  const project = validateProjectInput(body, { creating: false });
  const { changes } = db.run(
    `UPDATE Project SET Name = @name, MaterialBudgetCentavos = @budget, Status = @status WHERE ProjectId = @id`,
    { id, name: project.name, budget: project.materialBudgetCentavos, status: project.status }
  );
  if (changes === 0) {
    throw new HttpError(404, 'Project not found.');
  }
  return { id };
}

function isForeignKeyError(err) {
  if (!err) {
    return false;
  }
  return err.code === 'ERR_SQLITE_ERROR' && /FOREIGN KEY constraint failed/.test(err.message);
}

function deleteProject(id) {
  const project = db.get('SELECT Code FROM Project WHERE ProjectId = @id', { id });
  if (!project) {
    throw new HttpError(404, 'Project not found.');
  }
  try {
    db.run('DELETE FROM Project WHERE ProjectId = @id', { id });
  } catch (err) {
    if (isForeignKeyError(err)) {
      throw new HttpError(409, `${project.Code} is already used by documents (requisitions, purchase requisitions, purchase orders or stock records), so it cannot be deleted. Set it to Closed instead.`);
    }
    throw err;
  }
  return { id };
}

module.exports = { listProjects, createProject, updateProject, deleteProject };
