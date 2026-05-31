const fs = require('fs');
const path = require('path');

// Data directory (can be mapped outside Docker)
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const DB_PATH = path.join(DATA_DIR, 'db', 'mdviewer.db');
const MD_DIR = path.join(DATA_DIR, 'md');
const CONFIG_PATH = path.join(DATA_DIR, 'config', 'config.json');

// Ensure directories exist
[DATA_DIR, path.join(DATA_DIR, 'db'), MD_DIR, path.join(DATA_DIR, 'config')].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Default config
const defaultConfig = {
  listPublic: false,        // 列表页是否公开
  username: 'admin',
  password: 'admin123'
};

// Load or create config
let config = { ...defaultConfig };
if (fs.existsSync(CONFIG_PATH)) {
  config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
} else {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getConfig() {
  return config;
}

function updateConfig(newValues) {
  config = { ...config, ...newValues };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  MD_DIR,
  CONFIG_PATH,
  getConfig,
  updateConfig
};
