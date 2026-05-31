const express = require('express');
const router = express.Router();
const { getConfig, updateConfig } = require('../config');

// API: Update config
router.post('/api/config', (req, res) => {
  try {
    const config = updateConfig(req.body);
    res.json({ success: true, config });
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get config
router.get('/api/config', (req, res) => {
  res.json(getConfig());
});

module.exports = router;
