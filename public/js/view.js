/**
 * View page logic for MD Viewer
 */
const ViewPage = {
  currentDocId: null,
  currentDocVersion: 1,
  viewingVersion: 1,

  init() {
    this.currentDocId = window.location.pathname.split('/').pop();
    this.bindEvents();
    this.loadDocument();
    this.initTOC();
    this.initLightbox();
    this.initCodeLangLabels();
    this.initReadingProgress();
  },

  bindEvents() {
    // Export HTML
    document.getElementById('exportHtmlBtn').addEventListener('click', () => this.exportHTML());

    // Print
    document.getElementById('printBtn').addEventListener('click', () => window.print());

    // Version badge
    document.getElementById('versionBadge').addEventListener('click', () => this.showVersionHistory());

    // Version panel close
    document.getElementById('versionPanelClose').addEventListener('click', () => {
      document.getElementById('versionPanel').classList.remove('active');
    });
    document.getElementById('versionPanel').addEventListener('click', (e) => {
      if (e.target === document.getElementById('versionPanel')) {
        document.getElementById('versionPanel').classList.remove('active');
      }
    });

    // Password form
    document.getElementById('passwordForm').addEventListener('submit', (e) => this.handlePasswordSubmit(e));

    // TOC mobile toggle
    document.getElementById('tocMobileToggle').addEventListener('click', () => this.toggleTOCPanel());
    document.getElementById('tocMobileOverlay').addEventListener('click', () => this.toggleTOCPanel(false));
  },

  async loadDocument(docPassword) {
    const content = document.getElementById('content');
    const title = document.getElementById('docTitle');
    const header = document.getElementById('header');
    const passwordOverlay = document.getElementById('passwordOverlay');
    const versionBadge = document.getElementById('versionBadge');

    const fromList = document.referrer &&
      document.referrer.includes(window.location.origin) &&
      (document.referrer.endsWith('/') || document.referrer.includes('/?'));

    if (!fromList) {
      header.style.display = 'none';
      document.body.classList.add('no-header');
    }

    try {
      const fetchHeaders = {};
      if (docPassword) fetchHeaders['X-View-Password'] = docPassword;

      const res = await fetch('/api/documents/' + this.currentDocId, { headers: fetchHeaders });
      const data = await res.json();

      // 401 + requireAuth → redirect to login
      if (res.status === 401 && data.requireAuth) {
        window.location.href = '/login';
        return;
      }

      // 403 + requirePassword → show password card, hide skeleton
      if (res.status === 403 && data.requirePassword) {
        content.classList.remove('sk-wrap');
        content.innerHTML = '';
        passwordOverlay.classList.remove('hidden');
        title.textContent = '需要密码';
        return;
      }

      if (data.error) {
        content.innerHTML = '<div class="error">' + data.error + '</div>';
        title.textContent = '加载失败';
        return;
      }
      document.title = data.original_name + ' - MD Viewer';
      title.textContent = data.original_name;
      content.classList.remove('sk-wrap');
      content.innerHTML = data.html;

      // Show version badge
      this.currentDocVersion = data.version || 1;
      this.viewingVersion = this.currentDocVersion;
      if (this.currentDocVersion > 1) {
        versionBadge.textContent = 'v' + this.currentDocVersion;
        versionBadge.style.display = 'inline-flex';
      } else {
        versionBadge.style.display = 'none';
      }
    } catch (err) {
      content.innerHTML = '<div class="error">加载失败: ' + err.message + '</div>';
      title.textContent = '加载失败';
    }
  },

  async showVersionHistory() {
    if (!this.currentDocId) return;
    const versionPanelList = document.getElementById('versionPanelList');
    const versionPanel = document.getElementById('versionPanel');
    const versionBadge = document.getElementById('versionBadge');

    versionPanelList.innerHTML = '<li class="version-panel-empty">加载中...</li>';
    versionPanel.classList.add('active');

    try {
      const res = await fetch('/api/documents/' + this.currentDocId + '/versions');
      const versions = await res.json();
      if (!versions.length) {
        versionPanelList.innerHTML = '<li class="version-panel-empty">暂无版本记录</li>';
        return;
      }
      versionPanelList.innerHTML = versions.map(v => {
        const isCurrent = v.version === this.viewingVersion;
        const activeClass = isCurrent ? ' active' : '';
        const date = new Date(v.created_at + 'Z').toLocaleString('zh-CN');
        const currentLabel = isCurrent ? '<span class="version-panel-item-current">当前</span>' : '';
        const sizeInfo = v.file_size ? this.formatSize(v.file_size) : '';
        return '<li class="version-panel-item' + activeClass + '" data-version="' + v.version + '" data-is-current="' + !!isCurrent + '">' +
          '<span class="version-panel-item-version">v' + v.version + '</span>' +
          '<span class="version-panel-item-info"><strong>' + date + '</strong>' + (sizeInfo ? ' · ' + sizeInfo : '') + '</span>' +
          currentLabel +
          '</li>';
      }).join('');

      versionPanelList.querySelectorAll('.version-panel-item').forEach(item => {
        item.addEventListener('click', async () => {
          const version = parseInt(item.dataset.version, 10);
          const isCurrent = item.dataset.isCurrent === 'true';
          if (isCurrent) {
            // Reload current version
            this.loadDocument();
            this.viewingVersion = this.currentDocVersion;
            versionBadge.textContent = 'v' + this.currentDocVersion;
            versionPanel.classList.remove('active');
            return;
          }
          // Load historical version
          try {
            const res = await fetch('/api/documents/' + this.currentDocId + '/versions/' + version);
            const data = await res.json();
            if (data.error) {
              alert('加载失败: ' + data.error);
              return;
            }
            document.title = data.original_name + ' (v' + version + ') - MD Viewer';
            document.getElementById('docTitle').textContent = data.original_name + ' (v' + version + ')';
            document.getElementById('content').innerHTML = data.html;
            this.viewingVersion = version;
            versionBadge.textContent = 'v' + version;
            versionPanel.classList.remove('active');
            // Scroll to top
            window.scrollTo(0, 0);
          } catch (err) {
            alert('加载失败: ' + err.message);
          }
        });
      });
    } catch (err) {
      versionPanelList.innerHTML = '<li class="version-panel-empty">加载失败</li>';
    }
  },

  async handlePasswordSubmit(e) {
    e.preventDefault();
    const passwordError = document.getElementById('passwordError');
    const viewPasswordInput = document.getElementById('viewPasswordInput');
    const passwordSubmitBtn = document.getElementById('passwordSubmitBtn');

    passwordError.style.display = 'none';

    const pwd = viewPasswordInput.value.trim();
    if (!pwd) return;

    passwordSubmitBtn.disabled = true;
    passwordSubmitBtn.textContent = '验证中...';

    try {
      const res = await fetch('/api/documents/' + this.currentDocId, {
        headers: { 'X-View-Password': pwd }
      });
      const data = await res.json();

      if (res.status === 403 && data.requirePassword) {
        passwordError.textContent = '密码错误，请重试';
        passwordError.style.display = 'block';
        viewPasswordInput.value = '';
        viewPasswordInput.focus();
      } else if (data.error) {
        passwordError.textContent = data.error;
        passwordError.style.display = 'block';
      } else {
        // Success: hide overlay, show document
        document.getElementById('passwordOverlay').classList.add('hidden');
        document.title = data.original_name + ' - MD Viewer';
        document.getElementById('docTitle').textContent = data.original_name;
        document.getElementById('content').classList.remove('sk-wrap');
        document.getElementById('content').innerHTML = data.html;
      }
    } catch (err) {
      passwordError.textContent = '验证失败: ' + err.message;
      passwordError.style.display = 'block';
    } finally {
      passwordSubmitBtn.disabled = false;
      passwordSubmitBtn.textContent = '验证密码';
    }
  },

  exportHTML() {
    const content = document.getElementById('content');
    const title = document.getElementById('docTitle').textContent;
    const styles = document.querySelector('style').textContent;
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this.escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
<style>${styles}</style>
</head>
<body>
<div style="max-width:800px;margin:0 auto;padding:32px 20px;">
<div class="markdown-body">${content.innerHTML}</div>
</div>
</body>
</html>`;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'document') + '.html';
    a.click();
    URL.revokeObjectURL(url);
  },

  initTOC() {
    const contentEl = document.getElementById('content');
    const tocObserver = new MutationObserver(() => {
      if (!contentEl.classList.contains('sk-wrap') && contentEl.innerHTML.trim()) {
        this.generateTOC();
        tocObserver.disconnect();
      }
    });
    tocObserver.observe(contentEl, { childList: true, subtree: true });
  },

  generateTOC() {
    const content = document.getElementById('content');
    const headings = content.querySelectorAll('h2, h3');
    if (headings.length === 0) return;

    const tocList = document.getElementById('tocList');
    const tocMobileList = document.getElementById('tocMobileList');
    let html = '';
    headings.forEach((h, i) => {
      const id = 'toc-heading-' + i;
      h.id = id;
      const depth = h.tagName === 'H3' ? ' depth-3' : '';
      html += '<li><a class="toc-item' + depth + '" href="#' + id + '" data-target="' + id + '">' + this.escapeHtml(h.textContent) + '</a></li>';
    });
    tocList.innerHTML = html;
    tocMobileList.innerHTML = html;

    // IntersectionObserver for active highlighting
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          document.querySelectorAll('.toc-item').forEach(item => {
            item.classList.toggle('active', item.dataset.target === id);
          });
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    headings.forEach(h => observer.observe(h));

    // Smooth scroll for TOC links
    document.querySelectorAll('.toc-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(link.dataset.target);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Close mobile panel + overlay
          this.toggleTOCPanel(false);
        }
      });
    });
  },

  toggleTOCPanel(show) {
    const tocMobilePanel = document.getElementById('tocMobilePanel');
    const tocMobileOverlay = document.getElementById('tocMobileOverlay');
    const isOpen = typeof show === 'boolean' ? show : !tocMobilePanel.classList.contains('show');
    tocMobilePanel.classList.toggle('show', isOpen);
    tocMobileOverlay.classList.toggle('show', isOpen);
  },

  initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');

    document.addEventListener('click', (e) => {
      if (e.target.tagName === 'IMG' && e.target.closest('.markdown-body')) {
        lightboxImg.src = e.target.src;
        lightboxImg.alt = e.target.alt;
        lightbox.classList.add('active');
      }
    });

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target === lightboxImg) {
        lightbox.classList.remove('active');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') lightbox.classList.remove('active');
    });
  },

  initCodeLangLabels() {
    const contentEl = document.getElementById('content');
    const langLabelObserver = new MutationObserver(() => {
      if (!contentEl.classList.contains('sk-wrap')) {
        this.addCodeLangLabels();
      }
    });
    langLabelObserver.observe(contentEl, { childList: true, subtree: true });
  },

  addCodeLangLabels() {
    document.querySelectorAll('.markdown-body pre code').forEach(code => {
      const pre = code.parentElement;
      const langMatch = code.className.match(/language-(\w+)/);
      if (langMatch) {
        pre.setAttribute('data-lang', langMatch[1]);
      }
    });
  },

  initReadingProgress() {
    const readingProgress = document.getElementById('readingProgress');
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0;
      readingProgress.style.width = progress + '%';
    }, { passive: true });
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
document.addEventListener('DOMContentLoaded', () => ViewPage.init());