// User roles and authentication middleware.
const ROLES = {
  OWNER: 'owner',
  FOREMAN: 'foreman',
  CUSTODIAN: 'custodian',
  PURCHASER: 'purchaser',
  VERIFIER: 'verifier',
};

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Please log in.' });
  }
  next();
}

function requireRole(...allowed) {
  return function (req, res, next) {
    const user = req.session && req.session.user;
    if (!user) {
      return res.status(401).json({ error: 'Please log in.' });
    }
    if (!allowed.includes(user.role)) {
      return res.status(403).json({ error: 'Your role cannot do this.' });
    }
    next();
  };
}

module.exports = { ROLES, requireLogin, requireRole };
