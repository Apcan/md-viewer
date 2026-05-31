const express = require('express');
const session = require('express-session');
const path = require('path');
const { SESSION_SECRET, authMiddleware } = require('./auth');
const { getConfig } = require('./config');

const app = express();
const PORT = process.env.PORT || 3090;

// Middleware
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

// Global auth middleware
app.use(authMiddleware);

// Serve static files (static assets bypass auth via PUBLIC_EXTENSIONS check in auth middleware)
app.use(express.static(path.join(__dirname, '../public')));

// Import routes
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const documentsRoutes = require('./routes/documents');
const categoriesRoutes = require('./routes/categories');
const tagsRoutes = require('./routes/tags');
const configRoutes = require('./routes/config');
const pagesRoutes = require('./routes/pages');
const mcpRoutes = require('./routes/mcp');

// Mount routes
app.use(authRoutes);
app.use(uploadRoutes);
app.use(documentsRoutes);
app.use(categoriesRoutes);
app.use(tagsRoutes);
app.use(configRoutes);
app.use(pagesRoutes);
app.use(mcpRoutes);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MD Viewer running on port ${PORT}`);
  console.log(`Data directory: ${process.env.DATA_DIR || '/app/data'}`);
  console.log(`List public: ${getConfig().listPublic}`);
});
