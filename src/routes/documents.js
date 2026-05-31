const express = require('express');
const router = express.Router();
const fs = require('fs');
const { marked } = require('marked');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { MD_DIR } = require('../config');
const { hashPassword } = require('../auth');
const { countWords } = require('../utils/helpers');
const { checkDocumentPermission } = require('../middleware/permission');

// Helper: parse tags string from query result
function parseTags(tagsStr) {
  if (!tagsStr) return [];
  return tagsStr.split('~').map(tag => {
    const [id, name, color] = tag.split('|');
    return { id, name, color };
  });
}

// Helper: get document list with dynamic filters
function getDocuments(categoryId, tagId) {
  let whereConditions = [];
  let params = [];

  if (categoryId) {
    whereConditions.push('d.category_id = ?');
    params.push(categoryId);
  }

  if (tagId) {
    whereConditions.push('d.id IN (SELECT document_id FROM document_tags WHERE tag_id = ?)');
    params.push(tagId);
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

  const stmt = db.prepare(`
    SELECT d.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color) as tags_str
    FROM documents d
    LEFT JOIN document_tags dt ON d.id = dt.document_id
    LEFT JOIN tags t ON dt.tag_id = t.id
    ${whereClause}
    GROUP BY d.id
    ORDER BY d.sort_order ASC, d.starred DESC, d.created_at DESC
  `);

  return stmt.all(...params);
}

// API: List all documents (merged 4 branches into 1 dynamic query)
router.get('/api/documents', (req, res) => {
  try {
    const { category_id, tag_id } = req.query;
    const documents = getDocuments(category_id, tag_id);

    res.json(documents.map(doc => {
      const { view_password, file_path, tags_str, ...rest } = doc;
      const tags = parseTags(tags_str);
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
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get document content
router.get('/api/documents/:id', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
    const doc = stmt.get(req.params.id);

    if (!checkDocumentPermission(req, res, doc)) return;

    // Record view
    db.prepare('INSERT INTO recent_views (document_id) VALUES (?)').run(req.params.id);

    const content = fs.readFileSync(doc.file_path, 'utf-8');
    const html = marked(content);

    // Word count and reading time
    const word_count = countWords(content);
    const reading_time = Math.ceil(word_count / 400);

    // Return without view_password
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

// API: Get version history of a document
router.get('/api/documents/:id/versions', (req, res) => {
  try {
    const doc = db.prepare('SELECT id, version, created_at FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Permission check
    const fullDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!checkDocumentPermission(req, res, fullDoc)) return;

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
      file_size: fullDoc.file_size,
      filename: fullDoc.original_name,
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
router.get('/api/documents/:id/versions/:version', (req, res) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    if (isNaN(versionNum)) {
      return res.status(400).json({ error: 'Invalid version number' });
    }

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Permission check
    if (!checkDocumentPermission(req, res, doc)) return;

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

// API: Update document category (dedicated endpoint)
router.put('/api/documents/:id/category', (req, res) => {
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
router.put('/api/documents/:id/permission', (req, res) => {
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
router.put('/api/documents/:id/star', (req, res) => {
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
router.put('/api/documents/:id/description', (req, res) => {
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
router.put('/api/documents/:id/rename', (req, res) => {
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

// API: Set document tags (replace all)
router.put('/api/documents/:id/tags', (req, res) => {
  try {
    const { tag_ids } = req.body;
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }
    // Delete old tags first
    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(req.params.id);
    // Insert new tags
    const insertStmt = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)');
    const batch = db.transaction((ids) => {
      for (const tagId of ids) {
        // Verify tag exists
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

// API: Batch update document categories
router.post('/api/documents/batch-category', (req, res) => {
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

// API: Batch update document sort order (drag-and-drop)
router.post('/api/documents/sort', (req, res) => {
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

// API: Delete document
router.delete('/api/documents/:id', (req, res) => {
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

// API: Recent views (no auth required)
router.get('/api/recent-views', (req, res) => {
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
router.get('/api/document-counts', (req, res) => {
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

module.exports = router;
