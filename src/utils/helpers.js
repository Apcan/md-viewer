/**
 * Word count utility - Chinese characters count individually, English words by space
 */
function countWords(content) {
  const chinese = (content.match(/[一-鿿]/g) || []).length;
  const english = content.replace(/[一-鿿]/g, '').split(/\s+/).filter(w => w.length > 0).length;
  return chinese + english;
}

/**
 * Generate unique filename for uploaded files
 */
function generateFilename(originalName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const { v4: uuidv4 } = require('uuid');
  const ext = require('path').extname(originalName);
  const baseName = require('path').basename(originalName, ext);
  return `${timestamp}_${uuidv4().slice(0, 8)}_${baseName}${ext}`;
}

module.exports = {
  countWords,
  generateFilename
};
