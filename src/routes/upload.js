const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { MD_DIR } = require('../config');
const { hashPassword } = require('../auth');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate filename: timestamp_uuid.originalname
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
    // Handle Chinese filename encoding
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (file.originalname.endsWith('.md')) {
      cb(null, true);
    } else {
      cb(new Error('Only .md files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// API: Upload MD file
router.post('/api/upload', upload.single('file'), (req, res) => {
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
router.post('/api/check-duplicate', (req, res) => {
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

module.exports = router;
