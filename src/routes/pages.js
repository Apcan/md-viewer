const express = require('express');
const router = express.Router();
const path = require('path');

// Page: Upload page (no auth required)
router.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/upload.html'));
});

// Page: List page (protected via global auth middleware)
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Page: View page (no auth required)
router.get('/view/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/view.html'));
});

module.exports = router;
