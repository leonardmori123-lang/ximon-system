// Main Express server and route setup.
require('dotenv').config({ quiet: true });
const os = require('os');
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./db');

const app = express();

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  })
);

// Serve Bootstrap from local files so the app works offline.
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/health', require('./routes/health'));
app.use('/api', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/items', require('./routes/items'));
app.use('/api/requisitions', require('./routes/requisitions'));
app.use('/api/slips', require('./routes/slips'));
app.use('/api/purchasing', require('./routes/purchasing'));
app.use('/api/notifications', require('./routes/notifications'));

// Global error handler to convert errors into JSON messages.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Bad request.' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  if (db.isUniqueError(err)) {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Ximon system running on http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`Open on a phone (same Wi-Fi): http://${net.address}:${port}`);
        }
      }
    }
  });
}
