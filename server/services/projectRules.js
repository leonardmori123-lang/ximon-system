// Project rules that need no database, so they are easy to test.
// Money is whole centavos: PHP 4,500.00 is 450000.
const { HttpError } = require('./errors');

const PROJECT_STATUSES = ['active', 'closed'];
const MAX_BUDGET_CENTAVOS = 100000000000; // PHP 1,000,000,000

// Checks the project form. creating: the code is part of the form; after that it never changes.
// A budget of 0 means none was set, so no purchase is flagged as over budget.
function validateProjectInput(body, { creating }) {
  const input = body || {};
  const project = {};

  if (creating) {
    project.code = String(input.code == null ? '' : input.code).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(project.code)) {
      throw new HttpError(400, 'Project code: 2 to 30 characters, letters, digits and dashes only, like ADC-RECEPTION.');
    }
  }

  project.name = String(input.name == null ? '' : input.name).trim();
  if (!project.name || project.name.length > 200) throw new HttpError(400, 'Enter the project name, up to 200 characters.');

  const budget = input.materialBudgetCentavos;
  if (budget === undefined && creating) {
    project.materialBudgetCentavos = 0;
  } else if (typeof budget === 'number' && Number.isInteger(budget) && budget >= 0 && budget <= MAX_BUDGET_CENTAVOS) {
    project.materialBudgetCentavos = budget;
  } else {
    throw new HttpError(400, 'Enter the material budget in pesos, 0 or more (0 means none), up to PHP 1,000,000,000, with at most 2 decimals.');
  }

  if (creating) {
    project.status = 'active';
  } else {
    if (!PROJECT_STATUSES.includes(input.status)) throw new HttpError(400, 'Choose Active or Closed.');
    project.status = input.status;
  }
  return project;
}

module.exports = { PROJECT_STATUSES, MAX_BUDGET_CENTAVOS, validateProjectInput };
