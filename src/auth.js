const crypto = require('crypto');

// --- Auth config ---
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'md-viewer-session-secret';

// Public route prefix whitelist (no auth required)
const PUBLIC_PREFIXES = ['/login', '/upload', '/view/', '/api/upload', '/api/categories', '/api/recent-views', '/api/document-counts', '/mcp'];
// Exact public paths
const PUBLIC_EXACT = ['/login', '/upload', '/api/auth/status', '/api/recent-views', '/api/document-counts', '/mcp', '/api/check-duplicate'];
// Static asset extensions — always public
const PUBLIC_EXTENSIONS = ['.html', '.js', '.css', '.png', '.jpg', '.svg', '.ico'];

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

  // Check session authentication
  if (req.session && req.session.authenticated) return next();

  // API requests → 401 JSON
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Page requests → redirect to login
  return res.redirect('/login');
};

module.exports = {
  AUTH_PASSWORD,
  SESSION_SECRET,
  hashPassword,
  verifyPassword,
  authMiddleware
};
