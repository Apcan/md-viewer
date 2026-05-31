const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { DB_PATH } = require('./config');

// Helper: check if a column exists in a table
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

// Initialize database
const db = new Database(DB_PATH);

// --- Create tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    category_id TEXT,
    view_permission TEXT DEFAULT 'public',
    view_password TEXT,
    starred INTEGER DEFAULT 0,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS recent_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (document_id, tag_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    filename TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  )
`);

// --- Migration: add version column to documents ---
if (!columnExists('documents', 'version')) {
  db.exec(`ALTER TABLE documents ADD COLUMN version INTEGER DEFAULT 1`);
}

// --- Default "未分类" category ---
const defaultCat = db.prepare('SELECT id FROM categories WHERE name = ?').get('未分类');
if (!defaultCat) {
  const defaultCatId = uuidv4();
  db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, 0)').run(defaultCatId, '未分类');
}

module.exports = db;
