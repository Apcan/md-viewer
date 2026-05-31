const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// API: List all tags with document count
router.get('/api/tags', (req, res) => {
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
router.post('/api/tags', (req, res) => {
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
router.put('/api/tags/:id', (req, res) => {
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
router.delete('/api/tags/:id', (req, res) => {
  try {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) {
      return res.status(404).json({ error: '标签不存在' });
    }
    // Clean up document_tags associations
    db.prepare('DELETE FROM document_tags WHERE tag_id = ?').run(req.params.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Tag delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
