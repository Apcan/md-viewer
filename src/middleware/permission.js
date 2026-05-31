const db = require('../db');
const { AUTH_PASSWORD } = require('../auth');
const { verifyPassword } = require('../auth');

/**
 * Check document permission - unified middleware to eliminate duplication
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next
 * @param {Object} doc - Document object (must include view_permission, view_password)
 * @returns {boolean} - true if access allowed, false if response already sent
 */
function checkDocumentPermission(req, res, doc) {
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return false;
  }

  // Private: requires authentication
  if (doc.view_permission === 'private') {
    if (!AUTH_PASSWORD || !(req.session && req.session.authenticated)) {
      res.status(401).json({ error: 'Authentication required', requireAuth: true });
      return false;
    }
  } else if (doc.view_password) {
    // Password-protected: already logged in users can access directly
    const isAuth = AUTH_PASSWORD && req.session && req.session.authenticated;
    if (!isAuth) {
      const viewPassword = req.headers['x-view-password'];
      if (!viewPassword || !verifyPassword(viewPassword, doc.view_password)) {
        res.status(403).json({ error: 'Invalid password', requirePassword: true });
        return false;
      }
    }
  }

  return true;
}

module.exports = {
  checkDocumentPermission
};
