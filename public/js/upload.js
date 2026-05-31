/**
 * Upload page logic for MD Viewer
 */
const UploadPage = {
  pendingFile: null,
  pendingDuplicateDoc: null,

  init() {
    this.bindEvents();
    this.loadCategories();
  },

  bindEvents() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const dupModal = document.getElementById('dupModal');
    const dupNewBtn = document.getElementById('dupNewBtn');
    const dupUpdateBtn = document.getElementById('dupUpdateBtn');

    // Upload area click
    uploadArea.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this.uploadFile(e.target.files[0]);
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this.uploadFile(e.dataTransfer.files[0]);
    });

    // Permission radio change
    document.querySelectorAll('input[name="viewPermission"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const permPasswordWrap = document.getElementById('permPasswordWrap');
        permPasswordWrap.style.display = radio.value === 'password' && radio.checked ? 'block' : 'none';
      });
    });

    // Duplicate modal buttons
    dupNewBtn.addEventListener('click', () => {
      dupModal.classList.remove('active');
      if (this.pendingFile) {
        this.doUpload(this.pendingFile, null);
        this.pendingFile = null;
        this.pendingDuplicateDoc = null;
      }
    });

    dupUpdateBtn.addEventListener('click', () => {
      dupModal.classList.remove('active');
      if (this.pendingFile && this.pendingDuplicateDoc) {
        this.doUpload(this.pendingFile, this.pendingDuplicateDoc.id);
        this.pendingFile = null;
        this.pendingDuplicateDoc = null;
      }
    });

    dupModal.addEventListener('click', (e) => {
      if (e.target === dupModal) dupModal.classList.remove('active');
    });
  },

  async loadCategories() {
    try {
      const res = await fetch('/api/categories');
      const cats = await res.json();
      const sel = document.getElementById('categorySelect');
      sel.innerHTML = '<option value="">未分类</option>' +
        cats.map(c => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`).join('');
    } catch (e) { /* ignore */ }
  },

  async uploadFile(file) {
    if (!file.name.endsWith('.md')) {
      this.showResult('error', '只支持 .md 文件');
      return;
    }

    // Check for duplicate
    try {
      const res = await fetch('/api/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_name: file.name })
      });
      const data = await res.json();
      if (data.exists && data.document) {
        // Show duplicate modal
        this.pendingFile = file;
        this.pendingDuplicateDoc = data.document;
        const docVersion = data.document.version || 1;
        const docDate = new Date(data.document.created_at + 'Z').toLocaleString('zh-CN');
        const dupDocInfo = document.getElementById('dupDocInfo');
        dupDocInfo.innerHTML = '<strong>' + this.escapeHtml(data.document.original_name) + '</strong><br>当前版本: v' + docVersion + '<br>创建时间: ' + docDate;
        document.getElementById('dupModal').classList.add('active');
        return;
      }
    } catch (e) {
      // If check fails, proceed with normal upload
    }

    this.doUpload(file, null);
  },

  async doUpload(file, replaceDocumentId) {
    const formData = new FormData();
    formData.append('file', file);
    const catId = document.getElementById('categorySelect').value;
    if (catId) formData.append('category_id', catId);

    const docDesc = document.getElementById('docDescription').value.trim();
    if (docDesc) formData.append('description', docDesc);

    const permValue = document.querySelector('input[name="viewPermission"]:checked').value;
    formData.append('view_permission', permValue);
    if (permValue === 'password') {
      const viewPassword = document.getElementById('viewPassword');
      if (viewPassword.value.trim()) {
        formData.append('view_password', viewPassword.value.trim());
      }
    }

    if (replaceDocumentId) {
      formData.append('replace_document_id', replaceDocumentId);
    }

    this.showResult('success', '上传中...');

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();
      if (data.success) {
        const updateInfo = data.updated ? '<br>✅ 已更新为 v' + data.version : '';
        this.showResult('success', `上传成功！${updateInfo}<br>文件: ${this.escapeHtml(data.filename)}<br>大小: ${this.formatSize(data.size)}<br><br><a href="/view/${data.id}" target="_blank">点击查看</a>`);
        document.getElementById('fileInput').value = '';
      } else {
        this.showResult('error', '上传失败: ' + data.error);
      }
    } catch (err) {
      this.showResult('error', '上传失败: ' + err.message);
    }
  },

  showResult(type, message) {
    const result = document.getElementById('result');
    result.className = 'result-card ' + type;
    result.innerHTML = message;
    result.style.display = 'block';
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => UploadPage.init());