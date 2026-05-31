const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3090;

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

// Load or create config
let config = {
  listPublic: false,        // 列表页是否公开
  username: 'admin',
  password: 'admin123'
};
if (fs.existsSync(CONFIG_PATH)) {
  config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
} else {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Helper: check if a table exists
function tableExists(name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

// Helper: check if a column exists in a table
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

// 初始化数据库
const db = new Database(DB_PATH);

// --- 建表 ---
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

// --- 默认"未分类"分类 ---
const defaultCat = db.prepare('SELECT id FROM categories WHERE name = ?').get('未分类');
if (!defaultCat) {
  const defaultCatId = uuidv4();
  db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, 0)').run(defaultCatId, '未分类');
}

// --- Word count utility ---
function countWords(content) {
  // 中文按字符数，英文按空格分词
  const chinese = (content.match(/[一-鿿]/g) || []).length;
  const english = content.replace(/[一-鿿]/g, '').split(/\s+/).filter(w => w.length > 0).length;
  return chinese + english;
}

// --- Password utility functions ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const hashToVerify = crypto.scryptSync(password, salt, 64).toString("hex");
  return hash === hashToVerify;
}

// --- Auth config ---
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'md-viewer-session-secret';

// Public route prefix whitelist (no auth required)
const PUBLIC_PREFIXES = ['/login', '/upload', '/view/', '/api/upload', '/api/categories', '/api/recent-views', '/api/document-counts', '/mcp'];
// Exact public paths
const PUBLIC_EXACT = ['/login', '/upload', '/api/auth/status', '/api/recent-views', '/api/document-counts', '/mcp', '/api/check-duplicate'];
// Static asset extensions — always public
const PUBLIC_EXTENSIONS = ['.html', '.js', '.css', '.png', '.jpg', '.svg', '.ico'];

// Middleware
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

// Global auth middleware
const authMiddleware = (req, res, next) => {
  // If no password configured, everything is public (backward compatible)
  if (!AUTH_PASSWORD) return next();

  // Static assets are always public
  if (PUBLIC_EXTENSIONS.some(ext => req.path.endsWith(ext))) return next();

  // Exact public paths
  if (PUBLIC_EXACT.includes(req.path)) return next();

  // Public prefix whitelist (GET only for categories, documents/:id)
  if (req.path === '/api/categories' && req.method === 'GET') return next();
  if (/^\/api\/documents\/[^/]+$/.test(req.path) && req.method === 'GET') return next();
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();

  // Allow static files served by express.static (but they are handled above by extension check)

  // Check session authentication
  if (req.session && req.session.authenticated) return next();

  // API requests → 401 JSON
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Page requests → redirect to login
  return res.redirect('/login');
};

// Apply global auth middleware
app.use(authMiddleware);

// Serve static files after auth setup (static assets bypass auth via PUBLIC_EXTENSIONS check above)
app.use(express.static(path.join(__dirname, '../public')));

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MD_DIR);
  },
  filename: (req, file, cb) => {
    // 生成文件名：时间戳_uuid.原文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const uniqueName = `${timestamp}_${uuidv4().slice(0, 8)}_${baseName}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // 处理中文文件名编码
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (file.originalname.endsWith('.md')) {
      cb(null, true);
    } else {
      cb(new Error('Only .md files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// API: Auth status (public — used by login page to check if auth is required)
app.get('/api/auth/status', (req, res) => {
  res.json({ required: !!AUTH_PASSWORD, authenticated: !!(req.session && req.session.authenticated) });
});

// --- Login / Logout routes ---
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.post('/login', (req, res) => {
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

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// API: Upload MD file
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const replaceDocumentId = req.body.replace_document_id || null;

    // If replacing an existing document
    if (replaceDocumentId) {
      const existingDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(replaceDocumentId);
      if (!existingDoc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const newVersion = (existingDoc.version || 1) + 1;

      // Save current version to document_versions (keep old file on disk for history)
      const versionId = uuidv4();
      db.prepare(`
        INSERT INTO document_versions (id, document_id, version, file_path, file_size, filename, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(versionId, replaceDocumentId, existingDoc.version || 1, existingDoc.file_path, existingDoc.file_size, existingDoc.filename);

      // Update document with new file info
      db.prepare(`
        UPDATE documents SET file_path = ?, file_size = ?, filename = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.file.path, req.file.size, req.file.filename, newVersion, replaceDocumentId);

      return res.json({
        success: true,
        id: replaceDocumentId,
        filename: req.file.originalname,
        size: req.file.size,
        version: newVersion,
        updated: true
      });
    }

    // New document creation
    const id = uuidv4();
    const categoryId = req.body.category_id || null;
    const viewPermission = req.body.view_permission || 'public';
    const viewPassword = req.body.view_password ? hashPassword(req.body.view_password) : null;
    const description = req.body.description || null;

    const stmt = db.prepare(`
      INSERT INTO documents (id, filename, original_name, file_path, file_size, category_id, view_permission, view_password, description, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    stmt.run(
      id,
      req.file.filename,
      req.file.originalname,
      req.file.path,
      req.file.size,
      categoryId,
      viewPermission,
      viewPassword,
      description
    );

    res.json({
      success: true,
      id,
      filename: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Check duplicate document by original_name
app.post('/api/check-duplicate', (req, res) => {
  try {
    const { original_name } = req.body;
    if (!original_name) {
      return res.json({ exists: false });
    }
    const doc = db.prepare('SELECT id, original_name, version, created_at FROM documents WHERE original_name = ?').get(original_name);
    if (doc) {
      return res.json({ exists: true, document: doc });
    }
    return res.json({ exists: false });
  } catch (error) {
    console.error('Check duplicate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get version history of a document
app.get('/api/documents/:id/versions', (req, res) => {
  try {
    const doc = db.prepare('SELECT id, version, created_at FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 权限检查
    const fullDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (fullDoc.view_permission === 'private') {
      if (!AUTH_PASSWORD || !(req.session && req.session.authenticated)) {
        return res.status(401).json({ error: 'Authentication required', requireAuth: true });
      }
    } else if (fullDoc.view_permission === 'password') {
      const isAuth = AUTH_PASSWORD && req.session && req.session.authenticated;
      if (!isAuth) {
        const viewPassword = req.headers['x-view-password'];
        if (!viewPassword || !fullDoc.view_password || !verifyPassword(viewPassword, fullDoc.view_password)) {
          return res.status(403).json({ error: 'Invalid password', requirePassword: true });
        }
      }
    }

    const versions = db.prepare(`
      SELECT id, version, file_size, filename, created_at
      FROM document_versions
      WHERE document_id = ?
      ORDER BY version DESC
    `).all(req.params.id);

    // Add current version
    const currentVersion = {
      id: doc.id,
      version: doc.version || 1,
      file_size: doc.file_size,
      filename: doc.original_name,
      created_at: doc.created_at,
      is_current: true
    };

    return res.json([currentVersion, ...versions]);
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get specific version content
app.get('/api/documents/:id/versions/:version', (req, res) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    if (isNaN(versionNum)) {
      return res.status(400).json({ error: 'Invalid version number' });
    }

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 权限检查
    if (doc.view_permission === 'private') {
      if (!AUTH_PASSWORD || !(req.session && req.session.authenticated)) {
        return res.status(401).json({ error: 'Authentication required', requireAuth: true });
      }
    } else if (doc.view_permission === 'password') {
      const isAuth = AUTH_PASSWORD && req.session && req.session.authenticated;
      if (!isAuth) {
        const viewPassword = req.headers['x-view-password'];
        if (!viewPassword || !doc.view_password || !verifyPassword(viewPassword, doc.view_password)) {
          return res.status(403).json({ error: 'Invalid password', requirePassword: true });
        }
      }
    }

    // Current version
    if (versionNum === (doc.version || 1)) {
      const content = fs.readFileSync(doc.file_path, 'utf-8');
      const html = marked(content);
      const word_count = countWords(content);
      const reading_time = Math.ceil(word_count / 400);
      const { view_password, ...docWithoutPassword } = doc;
      return res.json({
        ...docWithoutPassword,
        content,
        html,
        word_count,
        reading_time
      });
    }

    // Historical version
    const versionRecord = db.prepare(
      'SELECT * FROM document_versions WHERE document_id = ? AND version = ?'
    ).get(req.params.id, versionNum);

    if (!versionRecord) {
      return res.status(404).json({ error: 'Version not found' });
    }

    if (!fs.existsSync(versionRecord.file_path)) {
      return res.status(404).json({ error: 'Version file not found on disk' });
    }

    const content = fs.readFileSync(versionRecord.file_path, 'utf-8');
    const html = marked(content);
    const word_count = countWords(content);
    const reading_time = Math.ceil(word_count / 400);

    return res.json({
      id: doc.id,
      original_name: doc.original_name,
      version: versionRecord.version,
      file_size: versionRecord.file_size,
      created_at: versionRecord.created_at,
      content,
      html,
      word_count,
      reading_time
    });
  } catch (error) {
    console.error('Get version content error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: List all documents
app.get('/api/documents', (req, res) => {
  try {
    const { category_id, tag_id } = req.query;
    let stmt;
    if (category_id && tag_id) {
      stmt = db.prepare(`
        SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        WHERE d.category_id = ? AND d.id IN (SELECT document_id FROM document_tags WHERE tag_id = ?)
        GROUP BY d.id
        ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
      `);
      const documents = stmt.all(category_id, tag_id);
      res.json(documents.map(doc => {
        const { view_password, file_path, tags_str, ...rest } = doc;
        const tags = tags_str ? tags_str.split('~').map(tag => {
          const [id, name, color] = tag.split('|');
          return { id, name, color };
        }) : [];
        let word_count = 0, reading_time = 1;
        try {
          if (file_path && fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            word_count = countWords(content);
            reading_time = Math.ceil(word_count / 400);
          }
        } catch (e) { /* ignore read errors */ }
        return { ...rest, word_count, reading_time, tags };
      }));
    } else if (category_id) {
      stmt = db.prepare(`
        SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        WHERE d.category_id = ?
        GROUP BY d.id
        ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
      `);
      const documents = stmt.all(category_id);
      res.json(documents.map(doc => {
        const { view_password, file_path, tags_str, ...rest } = doc;
        const tags = tags_str ? tags_str.split('~').map(tag => {
          const [id, name, color] = tag.split('|');
          return { id, name, color };
        }) : [];
        let word_count = 0, reading_time = 1;
        try {
          if (file_path && fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            word_count = countWords(content);
            reading_time = Math.ceil(word_count / 400);
          }
        } catch (e) { /* ignore read errors */ }
        return { ...rest, word_count, reading_time, tags };
      }));
    } else if (tag_id) {
      stmt = db.prepare(`
        SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        WHERE d.id IN (SELECT document_id FROM document_tags WHERE tag_id = ?)
        GROUP BY d.id
        ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
      `);
      const documents = stmt.all(tag_id);
      res.json(documents.map(doc => {
        const { view_password, file_path, tags_str, ...rest } = doc;
        const tags = tags_str ? tags_str.split('~').map(tag => {
          const [id, name, color] = tag.split('|');
          return { id, name, color };
        }) : [];
        let word_count = 0, reading_time = 1;
        try {
          if (file_path && fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            word_count = countWords(content);
            reading_time = Math.ceil(word_count / 400);
          }
        } catch (e) { /* ignore read errors */ }
        return { ...rest, word_count, reading_time, tags };
      }));
    } else {
      stmt = db.prepare(`
        SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        GROUP BY d.id
        ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
      `);
      const documents = stmt.all();
      res.json(documents.map(doc => {
        const { view_password, file_path, tags_str, ...rest } = doc;
        // 解析标签字符串为数组
        const tags = tags_str ? tags_str.split('~').map(tag => {
          const [id, name, color] = tag.split('|');
          return { id, name, color };
        }) : [];
        // 用 file_size 粗估字数和阅读时间
        const word_count = Math.round((doc.file_size || 0) / 2);
        const reading_time = Math.ceil(word_count / 400);
        return { ...rest, word_count, reading_time, tags };
      }));
    }
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get document content
app.get('/api/documents/:id', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
    const doc = stmt.get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 权限检查
    if (doc.view_permission === "private") {
      if (!AUTH_PASSWORD || !(req.session && req.session.authenticated)) {
        return res.status(401).json({ error: "Authentication required", requireAuth: true });
      }
    } else if (doc.view_permission === "password") {
      // 已登录用户可直接访问，无需输入密码
      const isAuth = AUTH_PASSWORD && req.session && req.session.authenticated;
      if (!isAuth) {
        const viewPassword = req.headers["x-view-password"];
        if (!viewPassword || !doc.view_password || !verifyPassword(viewPassword, doc.view_password)) {
          return res.status(403).json({ error: "Invalid password", requirePassword: true });
        }
      }
    }

    // Record view
    db.prepare('INSERT INTO recent_views (document_id) VALUES (?)').run(req.params.id);

    const content = fs.readFileSync(doc.file_path, 'utf-8');
    const html = marked(content);

    // 字数统计和阅读时间
    const word_count = countWords(content);
    const reading_time = Math.ceil(word_count / 400);

    // 返回时排除 view_password
    const { view_password, ...docWithoutPassword } = doc;
    res.json({
      ...docWithoutPassword,
      content,
      html,
      word_count,
      reading_time
    });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update document category (dedicated endpoint)
app.put('/api/documents/:id/category', (req, res) => {
  try {
    const { category_id } = req.body;
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    db.prepare('UPDATE documents SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(category_id || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Update document category error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update document permission
app.put('/api/documents/:id/permission', (req, res) => {
  try {
    const { view_permission, view_password } = req.body;
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const hashedPassword = view_password ? hashPassword(view_password) : null;

    db.prepare('UPDATE documents SET view_permission = ?, view_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(view_permission || 'public', hashedPassword, req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Update document permission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Toggle document star
app.put('/api/documents/:id/star', (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const newStarred = doc.starred ? 0 : 1;
    db.prepare('UPDATE documents SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newStarred, req.params.id);
    res.json({ success: true, starred: newStarred });
  } catch (error) {
    console.error('Toggle star error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update document description
app.put('/api/documents/:id/description', (req, res) => {
  try {
    const { description } = req.body;
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    db.prepare('UPDATE documents SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(description || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Update description error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Rename document
app.put('/api/documents/:id/rename', (req, res) => {
  try {
    const { original_name } = req.body;
    if (!original_name || !original_name.trim()) {
      return res.status(400).json({ error: '文件名不能为空' });
    }
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    db.prepare('UPDATE documents SET original_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(original_name.trim(), req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Rename document error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Batch update document categories
app.post('/api/documents/batch-category', (req, res) => {
  try {
    const { updates } = req.body; // [{id, category_id}, ...]
    const stmt = db.prepare('UPDATE documents SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const batch = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.category_id || null, item.id);
      }
    });
    batch(updates);
    res.json({ success: true, updated: updates.length });
  } catch (error) {
    console.error('Batch update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Recent views (no auth required)
app.get('/api/recent-views', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT d.id, d.original_name, d.category_id, c.name as category_name, rv.viewed_at
      FROM recent_views rv
      JOIN documents d ON d.id = rv.document_id
      LEFT JOIN categories c ON c.id = d.category_id
      WHERE rv.id IN (
        SELECT MAX(id) FROM recent_views GROUP BY document_id
      )
      ORDER BY rv.viewed_at DESC
      LIMIT 10
    `).all();
    res.json(rows);
  } catch (error) {
    console.error('Recent views error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Document counts per category (no auth required)
app.get('/api/document-counts', (req, res) => {
  try {
    const counts = db.prepare(`
      SELECT category_id, COUNT(*) as count
      FROM documents
      GROUP BY category_id
    `).all();
    res.json(counts);
  } catch (error) {
    console.error('Document counts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Delete document
app.delete('/api/documents/:id', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
    const doc = stmt.get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete version files
    const versions = db.prepare('SELECT file_path FROM document_versions WHERE document_id = ?').all(req.params.id);
    for (const v of versions) {
      if (v.file_path && fs.existsSync(v.file_path)) {
        fs.unlinkSync(v.file_path);
      }
    }

    // Delete current file
    if (fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }

    // Delete from database (cascade document_tags, document_versions)
    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(req.params.id);
    const deleteStmt = db.prepare('DELETE FROM documents WHERE id = ?');
    deleteStmt.run(req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: List all categories
app.get('/api/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all();
    res.json(categories);
  } catch (error) {
    console.error('Categories list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Create category
app.post('/api/categories', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '分类名称不能为空' });
    }
    const id = uuidv4();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM categories').get();
    const sortOrder = (maxOrder.max_order || 0) + 1;
    db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)').run(id, name.trim(), sortOrder);
    res.json({ success: true, id, name: name.trim(), sort_order: sortOrder });
  } catch (error) {
    console.error('Category create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update category
app.put('/api/categories/:id', (req, res) => {
  try {
    const { name } = req.body;
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!cat) {
      return res.status(404).json({ error: '分类不存在' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '分类名称不能为空' });
    }
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Category update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Delete category
app.delete('/api/categories/:id', (req, res) => {
  try {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!cat) {
      return res.status(404).json({ error: '分类不存在' });
    }
    if (cat.name === '未分类') {
      return res.status(400).json({ error: '不能删除"未分类"分类' });
    }
    // Move documents to default "未分类" category
    const defaultCat = db.prepare('SELECT id FROM categories WHERE name = ?').get('未分类');
    if (defaultCat) {
      db.prepare('UPDATE documents SET category_id = ? WHERE category_id = ?').run(defaultCat.id, req.params.id);
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Category delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update config
app.post('/api/config', (req, res) => {
  try {
    config = { ...config, ...req.body };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    res.json({ success: true, config });
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// --- Tags CRUD API ---

// API: List all tags with document count
app.get('/api/tags', (req, res) => {
  try {
    const tags = db.prepare(`
      SELECT t.*, COUNT(dt.document_id) as document_count
      FROM tags t
      LEFT JOIN document_tags dt ON t.id = dt.tag_id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `).all();
    res.json(tags);
  } catch (error) {
    console.error('Tags list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Create tag
app.post('/api/tags', (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '标签名称不能为空' });
    }
    const id = uuidv4();
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(id, name.trim(), color || '#6366f1');
    res.json({ success: true, id, name: name.trim(), color: color || '#6366f1' });
  } catch (error) {
    console.error('Tag create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update tag
app.put('/api/tags/:id', (req, res) => {
  try {
    const { name, color } = req.body;
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) {
      return res.status(404).json({ error: '标签不存在' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '标签名称不能为空' });
    }
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
      .run(name.trim(), color || tag.color, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Tag update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Delete tag
app.delete('/api/tags/:id', (req, res) => {
  try {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) {
      return res.status(404).json({ error: '标签不存在' });
    }
    // 清理 document_tags 关联
    db.prepare('DELETE FROM document_tags WHERE tag_id = ?').run(req.params.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Tag delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Set document tags (replace all)
app.put('/api/documents/:id/tags', (req, res) => {
  try {
    const { tag_ids } = req.body;
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }
    // 先删除旧标签
    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(req.params.id);
    // 再插入新标签
    const insertStmt = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)');
    const batch = db.transaction((ids) => {
      for (const tagId of ids) {
        // 验证标签存在
        const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
        if (tag) {
          insertStmt.run(req.params.id, tagId);
        }
      }
    });
    batch(tag_ids || []);
    res.json({ success: true });
  } catch (error) {
    console.error('Set document tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Drag-and-drop Sort API ---

// API: Batch update document sort order
app.post('/api/documents/sort', (req, res) => {
  try {
    const { ordered_ids } = req.body;
    if (!Array.isArray(ordered_ids)) {
      return res.status(400).json({ error: 'ordered_ids must be an array' });
    }
    const stmt = db.prepare('UPDATE documents SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const batch = db.transaction((ids) => {
      ids.forEach((id, index) => {
        stmt.run(index, id);
      });
    });
    batch(ordered_ids);
    res.json({ success: true, updated: ordered_ids.length });
  } catch (error) {
    console.error('Sort update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Page: Upload page (no auth required)
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/upload.html'));
});

// Page: List page (protected via global auth middleware)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Page: View page (no auth required)
app.get('/view/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/view.html'));
});

// --- MCP endpoint (Model Context Protocol) ---
app.post('/mcp', (req, res) => {
  // Bearer token authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer token required' });
  }
  const token = authHeader.slice(7);
  if (AUTH_PASSWORD && token !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { jsonrpc, id, method, params } = req.body;
  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
  }

  try {
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'md-viewer', version: '1.0.0' }
        }
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          tools: [
            {
              name: 'list_documents',
              description: 'List all documents, optionally filtered by category',
              inputSchema: {
                type: 'object',
                properties: {
                  category_id: { type: 'string', description: 'Filter by category ID' }
                }
              }
            },
            {
              name: 'get_document',
              description: 'Get a document by ID, including content and rendered HTML',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' }
                },
                required: ['id']
              }
            },
            {
              name: 'search_documents',
              description: 'Search documents by filename or content keyword',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search keyword' }
                },
                required: ['query']
              }
            },
            {
              name: 'create_document',
              description: 'Create a new document by uploading markdown content. Optionally replace an existing document.',
              inputSchema: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: 'Filename (must end with .md)' },
                  content: { type: 'string', description: 'Markdown content' },
                  category_id: { type: 'string', description: 'Category ID (optional)' },
                  replace_document_id: { type: 'string', description: 'Document ID to replace (optional). If provided, saves current version to history and updates the document.' }
                },
                required: ['filename', 'content']
              }
            },
            {
              name: 'delete_document',
              description: 'Delete a document by ID',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' }
                },
                required: ['id']
              }
            },
            {
              name: 'list_categories',
              description: 'List all document categories',
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'update_document_permission',
              description: 'Update document view permission (public/private/password)',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' },
                  view_permission: { type: 'string', enum: ['public', 'private', 'password'], description: 'View permission level' },
                  view_password: { type: 'string', description: 'Password for password-protected documents (optional)' }
                },
                required: ['id', 'view_permission']
              }
            },
            {
              name: 'toggle_star',
              description: 'Toggle document star/favorite status',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' }
                },
                required: ['id']
              }
            },
            {
              name: 'set_document_description',
              description: 'Set document description/note',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' },
                  description: { type: 'string', description: 'Document description (set to empty string to clear)' }
                },
                required: ['id']
              }
            },
            {
              name: 'list_tags',
              description: 'List all tags with document counts',
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'create_tag',
              description: 'Create a new tag',
              inputSchema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Tag name' },
                  color: { type: 'string', description: 'Tag color in hex format (e.g. #6366f1)' }
                },
                required: ['name']
              }
            },
            {
              name: 'set_document_tags',
              description: 'Set tags for a document (replaces existing tags)',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' },
                  tag_ids: { type: 'array', items: { type: 'string' }, description: 'Array of tag IDs' }
                },
                required: ['id', 'tag_ids']
              }
            },
            {
              name: 'update_document_sort',
              description: 'Batch update document sort order',
              inputSchema: {
                type: 'object',
                properties: {
                  ordered_ids: { type: 'array', items: { type: 'string' }, description: 'Document IDs in desired order' }
                },
                required: ['ordered_ids']
              }
            },
            {
              name: 'get_document_versions',
              description: 'Get version history of a document',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' }
                },
                required: ['id']
              }
            },
            {
              name: 'get_document_version',
              description: 'Get content of a specific document version',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Document ID' },
                  version: { type: 'number', description: 'Version number' }
                },
                required: ['id', 'version']
              }
            }
          ]
        }
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      let result;

      switch (name) {
        case 'list_documents': {
          const { category_id } = args || {};
          let docs;
          if (category_id) {
            docs = db.prepare(`
              SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
              FROM documents d
              LEFT JOIN document_tags dt ON d.id = dt.document_id
              LEFT JOIN tags t ON dt.tag_id = t.id
              WHERE d.category_id = ?
              GROUP BY d.id
              ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
            `).all(category_id);
          } else {
            docs = db.prepare(`
              SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
              FROM documents d
              LEFT JOIN document_tags dt ON d.id = dt.document_id
              LEFT JOIN tags t ON dt.tag_id = t.id
              GROUP BY d.id
              ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
            `).all();
          }
          // 解析标签并清理敏感字段
          const parsed = docs.map(doc => {
            const { view_password, file_path, tags_str, ...rest } = doc;
            const tags = tags_str ? tags_str.split('~').map(tag => {
              const [id, name, color] = tag.split('|');
              return { id, name, color };
            }) : [];
            return { ...rest, tags };
          });
          result = { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
          break;
        }

        case 'get_document': {
          const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(args.id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          db.prepare('INSERT INTO recent_views (document_id) VALUES (?)').run(args.id);
          const content = fs.readFileSync(doc.file_path, 'utf-8');
          const html = marked(content);
          // 返回时排除 view_password
          const { view_password: _, ...docWithoutPassword } = doc;
          result = { content: [{ type: 'text', text: JSON.stringify({ ...docWithoutPassword, content, html }, null, 2) }] };
          break;
        }

        case 'search_documents': {
          const { query } = args || {};
          const docs = db.prepare(`
            SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
            FROM documents d
            LEFT JOIN document_tags dt ON d.id = dt.document_id
            LEFT JOIN tags t ON dt.tag_id = t.id
            WHERE d.original_name LIKE ? OR d.filename LIKE ?
            GROUP BY d.id
            ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
          `).all(`%${query}%`, `%${query}%`);
          const parsed = docs.map(doc => {
            const { view_password, file_path, tags_str, ...rest } = doc;
            const tags = tags_str ? tags_str.split('~').map(tag => {
              const [id, name, color] = tag.split('|');
              return { id, name, color };
            }) : [];
            return { ...rest, tags };
          });
          result = { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
          break;
        }

        case 'create_document': {
          const { filename, content, category_id, replace_document_id } = args || {};
          if (!filename || !content) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'filename and content are required' } });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const safeFilename = `${timestamp}_${uuidv4().slice(0, 8)}_${filename}`;
          const filePath = path.join(MD_DIR, safeFilename);
          fs.writeFileSync(filePath, content, 'utf-8');

          // Replace existing document
          if (replace_document_id) {
            const existingDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(replace_document_id);
            if (!existingDoc) {
              return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
            }
            const newVersion = (existingDoc.version || 1) + 1;
            // Save current version to history (keep old file on disk)
            const versionId = uuidv4();
            db.prepare(`
              INSERT INTO document_versions (id, document_id, version, file_path, file_size, filename, created_at)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(versionId, replace_document_id, existingDoc.version || 1, existingDoc.file_path, existingDoc.file_size, existingDoc.filename);
            // Update document
            db.prepare(`
              UPDATE documents SET file_path = ?, file_size = ?, filename = ?, version = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(filePath, Buffer.byteLength(content), safeFilename, newVersion, replace_document_id);
            result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id: replace_document_id, filename, version: newVersion, updated: true }, null, 2) }] };
          } else {
            const docId = uuidv4();
            db.prepare(
              'INSERT INTO documents (id, filename, original_name, file_path, file_size, category_id, version) VALUES (?, ?, ?, ?, ?, ?, 1)'
            ).run(docId, safeFilename, filename, filePath, Buffer.byteLength(content), category_id || null);
            result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id: docId, filename }, null, 2) }] };
          }
          break;
        }

        case 'delete_document': {
          const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(args.id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          // Delete version files
          const versions = db.prepare('SELECT file_path FROM document_versions WHERE document_id = ?').all(args.id);
          for (const v of versions) {
            if (v.file_path && fs.existsSync(v.file_path)) fs.unlinkSync(v.file_path);
          }
          if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);
          db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(args.id);
          db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(args.id);
          db.prepare('DELETE FROM documents WHERE id = ?').run(args.id);
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
          break;
        }

        case 'list_categories': {
          const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all();
          result = { content: [{ type: 'text', text: JSON.stringify(cats, null, 2) }] };
          break;
        }

        case 'update_document_permission': {
          const { id, view_permission, view_password } = args || {};
          const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          const hashedPassword = view_password ? hashPassword(view_password) : null;
          db.prepare('UPDATE documents SET view_permission = ?, view_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(view_permission || 'public', hashedPassword, id);
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id, view_permission }, null, 2) }] };
          break;
        }

        case 'toggle_star': {
          const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(args.id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          const newStarred = doc.starred ? 0 : 1;
          db.prepare('UPDATE documents SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(newStarred, args.id);
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id: args.id, starred: newStarred }, null, 2) }] };
          break;
        }

        case 'set_document_description': {
          const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(args.id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          db.prepare('UPDATE documents SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(args.description || null, args.id);
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id: args.id }, null, 2) }] };
          break;
        }

        case 'list_tags': {
          const tags = db.prepare(`
            SELECT t.*, COUNT(dt.document_id) as document_count
            FROM tags t
            LEFT JOIN document_tags dt ON t.id = dt.tag_id
            GROUP BY t.id
            ORDER BY t.created_at DESC
          `).all();
          result = { content: [{ type: 'text', text: JSON.stringify(tags, null, 2) }] };
          break;
        }

        case 'create_tag': {
          const { name, color } = args || {};
          if (!name || !name.trim()) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Tag name is required' } });
          }
          const tagId = uuidv4();
          db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(tagId, name.trim(), color || '#6366f1');
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id: tagId, name: name.trim(), color: color || '#6366f1' }, null, 2) }] };
          break;
        }

        case 'set_document_tags': {
          const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(args.id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(args.id);
          const insertStmt = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)');
          const batch = db.transaction((ids) => {
            for (const tagId of ids) {
              const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
              if (tag) {
                insertStmt.run(args.id, tagId);
              }
            }
          });
          batch(args.tag_ids || []);
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true, id: args.id }, null, 2) }] };
          break;
        }

        case 'update_document_sort': {
          const { ordered_ids } = args || {};
          if (!Array.isArray(ordered_ids)) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'ordered_ids must be an array' } });
          }
          const sortStmt = db.prepare('UPDATE documents SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
          const sortBatch = db.transaction((ids) => {
            ids.forEach((docId, index) => {
              sortStmt.run(index, docId);
            });
          });
          sortBatch(ordered_ids);
          result = { content: [{ type: 'text', text: JSON.stringify({ success: true, updated: ordered_ids.length }, null, 2) }] };
          break;
        }

        case 'get_document_versions': {
          const doc = db.prepare('SELECT id, version, created_at FROM documents WHERE id = ?').get(args.id);
          if (!doc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          const versions = db.prepare(`
            SELECT id, version, file_size, filename, created_at
            FROM document_versions
            WHERE document_id = ?
            ORDER BY version DESC
          `).all(args.id);
          const currentVersion = {
            id: doc.id,
            version: doc.version || 1,
            file_size: null,
            filename: null,
            created_at: doc.created_at,
            is_current: true
          };
          result = { content: [{ type: 'text', text: JSON.stringify([currentVersion, ...versions], null, 2) }] };
          break;
        }

        case 'get_document_version': {
          const versionNum = parseInt(args.version, 10);
          if (isNaN(versionNum)) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid version number' } });
          }
          const versionDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(args.id);
          if (!versionDoc) {
            return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Document not found' } });
          }
          if (versionNum === (versionDoc.version || 1)) {
            const vContent = fs.readFileSync(versionDoc.file_path, 'utf-8');
            const vHtml = marked(vContent);
            const { view_password: _, ...vDocNoPwd } = versionDoc;
            result = { content: [{ type: 'text', text: JSON.stringify({ ...vDocNoPwd, content: vContent, html: vHtml }, null, 2) }] };
          } else {
            const versionRecord = db.prepare('SELECT * FROM document_versions WHERE document_id = ? AND version = ?').get(args.id, versionNum);
            if (!versionRecord) {
              return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Version not found' } });
            }
            if (!fs.existsSync(versionRecord.file_path)) {
              return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Version file not found on disk' } });
            }
            const vContent = fs.readFileSync(versionRecord.file_path, 'utf-8');
            const vHtml = marked(vContent);
            result = { content: [{ type: 'text', text: JSON.stringify({ id: versionDoc.id, original_name: versionDoc.original_name, version: versionRecord.version, file_size: versionRecord.file_size, created_at: versionRecord.created_at, content: vContent, html: vHtml }, null, 2) }] };
          }
          break;
        }

        default:
          return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      }

      return res.json({ jsonrpc: '2.0', id, result });
    }

    // Unknown method
    return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    console.error('MCP error:', err);
    return res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MD Viewer running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`List public: ${config.listPublic}`);
});
