const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// API: List all categories
router.get('/api/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all();
    res.json(categories);
  } catch (error) {
    console.error('Categories list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Create category
router.post('/api/categories', (req, res) => {
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
router.put('/api/categories/:id', (req, res) => {
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
router.delete('/api/categories/:id', (req, res) => {
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

module.exports = router;
