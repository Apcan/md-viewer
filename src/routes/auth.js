const express = require('express');
const router = express.Router();
const path = require('path');
const { AUTH_PASSWORD } = require('../auth');

// API: Auth status (public — used by login page to check if auth is required)
router.get('/api/auth/status', (req, res) => {
  res.json({ required: !!AUTH_PASSWORD, authenticated: !!(req.session && req.session.authenticated) });
});

// Login page
router.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../../public/login.html'));
});

// Login
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!AUTH_PASSWORD) {
    // No password configured — auto-authenticate
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  if (password === AUTH_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid password' });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

module.exports = router;
