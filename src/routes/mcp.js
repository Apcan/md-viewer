const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { MD_DIR } = require('../config');
const { AUTH_PASSWORD, hashPassword } = require('../auth');

// --- MCP endpoint (Model Context Protocol) ---
router.post('/mcp', (req, res) => {
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
          // Parse tags and clean sensitive fields
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
          // Return without view_password
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

module.exports = router;
