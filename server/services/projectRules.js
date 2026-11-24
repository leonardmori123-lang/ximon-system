// Validation rules for construction project records and budgets.
const { HttpError } = require('./errors');

const PROJECT_STATUSES = ['active', 'closed'];
const MAX_BUDGET_CENTAVOS = 100000000000; // PHP 1,000,000,000

// Money is stored in centavos (PHP 1.00 = 100 centavos).
function validateProjectInput(body, options = {}) {
  const creating = Boolean(options.creating);
  const input = body || {};
  const project = {};

  if (creating) {
    const rawCode = input.code == null ? '' : input.code;
    project.code = String(rawCode).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(project.code)) {
      throw new HttpError(400, 'Project code: 2 to 30 characters, letters, digits and dashes only, like ADC-RECEPTION.');
    }
  }

  const rawName = input.name == null ? '' : input.name;
  project.name = String(rawName).trim();
  if (!project.name || project.name.length > 200) {
    throw new HttpError(400, 'Enter the project name, up to 200 characters.');
  }

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
    if (!PROJECT_STATUSES.includes(input.status)) {
      throw new HttpError(400, 'Choose Active or Closed.');
    }
    project.status = input.status;
  }
  return project;
}

module.exports = { PROJECT_STATUSES, MAX_BUDGET_CENTAVOS, validateProjectInput };
