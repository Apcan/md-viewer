// Documents list page logic

// Data
let categories = [];
let allDocuments = [];
let currentCategoryId = '';
let documentCounts = {};
let editingDocId = null;
let allTags = [];
let currentTagId = '';
let searchQuery = '';
let searchTimer = null;

// Category colors
const CAT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];

function getCatColor(catId) {
  if (!catId) return CAT_COLORS[0];
  const idx = categories.findIndex(c => c.id === catId);
  return CAT_COLORS[((idx >= 0 ? idx : 0) % CAT_COLORS.length)];
}

// DOM elements
const documentsGrid = document.getElementById('documentsGrid');
const docCountBar = document.getElementById('docCountBar');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const tabBarInner = document.getElementById('tabBarInner');
const tabUnderline = document.getElementById('tabUnderline');
const tagFilterBar = document.getElementById('tagFilterBar');
const recentSection = document.getElementById('recentSection');
const recentHeader = document.getElementById('recentHeader');
const recentArrow = document.getElementById('recentArrow');
const recentList = document.getElementById('recentList');

// Search
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = searchInput.value.trim();
    searchClear.classList.toggle('show', !!searchQuery);
    loadDocuments();
  }, 200);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.remove('show');
  loadDocuments();
});

// Load documents
async function loadDocuments() {
  try {
    let url = '/api/documents';
    const params = [];
    if (currentCategoryId) params.push('category_id=' + encodeURIComponent(currentCategoryId));
    if (currentTagId) params.push('tag_id=' + encodeURIComponent(currentTagId));
    if (params.length) url += '?' + params.join('&');

    const res = await apiFetch(url);
    if (!res) return;
    const docs = await res.json();
    allDocuments = docs;

    // Client-side search filter
    const filtered = searchQuery
      ? docs.filter(d => d.original_name.toLowerCase().includes(searchQuery.toLowerCase()))
      : docs;

    docCountBar.textContent = searchQuery
      ? filtered.length + '/' + docs.length + ' 篇文档'
      : '共 ' + docs.length + ' 篇文档';

    if (filtered.length === 0 && !searchQuery) {
      documentsGrid.innerHTML = '<div class="empty-state">' +
        '<div class="empty-state-icon">📝</div>' +
        '<div class="empty-state-text">暂无文档</div>' +
        '<div class="empty-state-hint">点击右上角 + 上传你的第一个 Markdown 文件</div>' +
        '<a href="/upload" class="btn btn-primary" style="text-decoration:none;display:inline-block">上传文档</a>' +
        '</div>';
      return;
    }

    if (filtered.length === 0 && searchQuery) {
      documentsGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">没有找到「' + searchQuery + '」相关的文档</div></div>';
      return;
    }

    const catMap = {};
    categories.forEach(c => { catMap[c.id] = c.name; });

    documentsGrid.innerHTML = filtered.map(doc => {
      const catName = catMap[doc.category_id] || '未分类';
      const catColor = getCatColor(doc.category_id);
      const permIcon = doc.view_permission === 'private' ? ' 🔒' : doc.view_permission === 'password' ? ' 🔑' : '';
      const starClass = doc.starred ? ' starred' : '';
      const starChar = doc.starred ? '★' : '☆';
      const desc = doc.description ? '<div class="doc-card-desc">' + escapeHtml(doc.description) + '</div>' : '';
      const tagPills = (doc.tags && doc.tags.length > 0)
        ? '<div class="doc-card-tags">' + doc.tags.map(t =>
            '<span class="doc-card-tag-pill" style="background:' + t.color + '15;color:' + t.color + '"><span class="doc-card-tag-dot" style="background:' + t.color + '"></span>' + escapeHtml(t.name) + '</span>'
          ).join('') + '</div>'
        : '';
      const meta = '<div class="doc-card-meta">' + (doc.word_count || 0) + ' 字 · 约 ' + (doc.reading_time || 1) + ' 分钟</div>';
      const versionBadge = (doc.version && doc.version > 1) ? '<span class="doc-card-version">v' + doc.version + '</span>' : '';
      return '<div class="doc-card" draggable="' + (!searchQuery) + '" data-id="' + doc.id + '">' +
        '<div class="doc-card-header">' +
        '<button class="doc-card-star' + starClass + '" onclick="toggleStar(\'' + doc.id + '\', this)" title="收藏">' + starChar + '</button>' +
        '<div class="doc-card-name" data-doc-id="' + doc.id + '">' + escapeHtml(doc.original_name) + '</div>' +
        versionBadge +
        '<button class="doc-card-copy" onclick="copyLink(\'' + doc.id + '\', this)" title="复制链接">🔗</button>' +
        '</div>' +
        desc +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<div class="doc-card-cat-pill" style="background:' + catColor + '12;color:' + catColor + '">' +
        '<span class="doc-card-cat-dot" style="background:' + catColor + '"></span>' +
        escapeHtml(catName) + permIcon + '</div>' +
        tagPills +
        '</div>' +
        meta +
        '<div class="doc-card-actions">' +
        '<button class="btn btn-edit" onclick="openCatSelect(\'' + doc.id + '\')" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>编辑</button>' +
        '<button class="btn btn-delete" onclick="deleteDoc(\'' + doc.id + '\')" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>删除</button>' +
        '</div></div>';
    }).join('');

    documentsGrid.classList.remove('fade-in');
    void documentsGrid.offsetWidth;
    documentsGrid.classList.add('fade-in');

    // Bind drag events
    if (!searchQuery) {
      documentsGrid.querySelectorAll('.doc-card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', card.dataset.id);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', async (e) => {
          e.preventDefault();
          card.classList.remove('drag-over');
          const draggedId = e.dataTransfer.getData('text/plain');
          const targetId = card.dataset.id;
          if (draggedId === targetId) return;
          const ids = filtered.map(d => d.id);
          const fromIdx = ids.indexOf(draggedId);
          const toIdx = ids.indexOf(targetId);
          if (fromIdx === -1 || toIdx === -1) return;
          ids.splice(fromIdx, 1);
          ids.splice(toIdx, 0, draggedId);
          try {
            await apiPost('/api/documents/sort', { ordered_ids: ids });
            await loadDocuments();
          } catch (err) { console.error('Sort failed:', err); }
        });
      });
    }
  } catch (err) {
    documentsGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">加载失败，请刷新重试</div></div>';
  }
}

function viewDoc(id) { window.location.href = '/view/' + id; }

// Inline rename on double-click
const clickTimers = {};

documentsGrid.addEventListener('click', (e) => {
  const nameEl = e.target.closest('.doc-card-name');
  if (!nameEl) return;
  const docId = nameEl.dataset.docId;
  if (!docId) return;
  if (nameEl.querySelector('input')) return;
  if (clickTimers[docId]) {
    clearTimeout(clickTimers[docId]);
    clickTimers[docId] = null;
    startRename(docId, nameEl);
    return;
  }
  clickTimers[docId] = setTimeout(() => {
    clickTimers[docId] = null;
    viewDoc(docId);
  }, 200);
});

function startRename(docId, nameEl) {
  const doc = allDocuments.find(d => d.id === docId);
  if (!doc) return;
  const currentName = doc.original_name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'doc-card-name-input';
  input.value = currentName;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();
  let saved = false;

  async function saveRename() {
    if (saved) return;
    const newName = input.value.trim();
    if (!newName || newName === currentName) {
      nameEl.textContent = currentName;
      return;
    }
    saved = true;
    try {
      const data = await apiPut('/api/documents/' + docId + '/rename', { original_name: newName });
      if (data && data.success) {
        nameEl.textContent = newName;
        doc.original_name = newName;
        showToast('文件名已更新');
      } else {
        nameEl.textContent = currentName;
        showToast('重命名失败: ' + (data ? data.error : 'Unknown error'));
      }
    } catch (err) {
      nameEl.textContent = currentName;
      showToast('重命名失败');
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
    else if (e.key === 'Escape') { saved = true; nameEl.textContent = currentName; }
  });
  input.addEventListener('blur', saveRename);
}

async function deleteDoc(id) {
  if (!confirm('确定要删除这个文档吗？')) return;
  try {
    const data = await apiDelete('/api/documents/' + id);
    if (data && data.success) loadDocuments();
    else alert('删除失败: ' + (data ? data.error : 'Unknown error'));
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

async function toggleStar(id, btn) {
  try {
    const data = await apiPut('/api/documents/' + id + '/star', {});
    if (data && data.success) {
      btn.textContent = data.starred ? '★' : '☆';
      btn.classList.toggle('starred', !!data.starred);
      showToast(data.starred ? '已收藏' : '已取消收藏');
      loadDocuments();
    }
  } catch (err) { console.error('Star toggle failed:', err); }
}

async function copyLink(id, btn) {
  const url = window.location.origin + '/view/' + id;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = '✓';
    btn.classList.add('copied');
    showToast('链接已复制');
    setTimeout(() => { btn.textContent = '🔗'; btn.classList.remove('copied'); }, 1500);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      btn.textContent = '✓';
      btn.classList.add('copied');
      showToast('链接已复制');
      setTimeout(() => { btn.textContent = '🔗'; btn.classList.remove('copied'); }, 1500);
    } catch (e) {
      showToast('复制失败，请手动复制');
    }
    document.body.removeChild(textarea);
  }
}

// Load tags
async function loadTags() {
  try {
    const res = await apiFetch('/api/tags');
    if (!res) return;
    allTags = await res.json();
    renderTagFilterBar();
  } catch (err) { console.error('Failed to load tags', err); }
}

function renderTagFilterBar() {
  if (!allTags.length) { tagFilterBar.innerHTML = ''; return; }
  let html = '<span class="tag-filter-label">标签:</span>';
  html += '<button class="tag-filter-pill' + (!currentTagId ? ' active' : '') + '" data-tag-id="" style="border-color:' + (!currentTagId ? 'var(--accent)' : '') + ';background:' + (!currentTagId ? 'var(--accent)' : '') + ';">全部</button>';
  allTags.forEach(t => {
    const isActive = currentTagId === t.id;
    html += '<button class="tag-filter-pill' + (isActive ? ' active' : '') + '" data-tag-id="' + t.id + '" style="' + (isActive ? 'background:' + t.color + ';border-color:' + t.color + ';' : '') + '">' +
      '<span class="tag-filter-dot" style="background:' + (isActive ? '#fff' : t.color) + '"></span>' +
      escapeHtml(t.name) + '</button>';
  });
  tagFilterBar.innerHTML = html;
  tagFilterBar.querySelectorAll('.tag-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTagId = btn.dataset.tagId;
      renderTagFilterBar();
      loadDocuments();
    });
  });
}

// Load categories
async function loadCategories() {
  try {
    const res = await apiFetch('/api/categories');
    if (!res) return;
    categories = await res.json();
    await loadDocumentCounts();
    renderTabs();
  } catch (err) {
    console.error('Failed to load categories', err);
  }
}

async function loadDocumentCounts() {
  try {
    const data = await apiGet('/api/document-counts');
    if (!data) return;
    documentCounts = {};
    data.forEach(c => { documentCounts[c.category_id || ''] = c.count; });
  } catch (err) {
    console.error('Failed to load document counts', err);
  }
}

// Tab rendering
function updateUnderline() {
  const activeTab = tabBarInner.querySelector('.tab-item.active');
  if (!activeTab) { tabUnderline.style.width = '0'; return; }
  const innerRect = tabBarInner.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  tabUnderline.style.left = (tabRect.left - innerRect.left) + 'px';
  tabUnderline.style.width = tabRect.width + 'px';
}

function renderTabs() {
  const uncategorized = categories.find(c => c.name === '未分类');
  const otherCats = categories.filter(c => c.name !== '未分类');
  let html = '<button class="tab-item' + (currentCategoryId === '' ? ' active' : '') + '" data-id="">全部</button>';
  otherCats.forEach(c => {
    const isActive = currentCategoryId === c.id;
    html += '<button class="tab-item' + (isActive ? ' active' : '') + '" data-id="' + c.id + '">' +
      escapeHtml(c.name) + '</button>';
  });
  if (uncategorized) {
    const isActive = currentCategoryId === uncategorized.id;
    html += '<button class="tab-item' + (isActive ? ' active' : '') + '" data-id="' + uncategorized.id + '">' +
      escapeHtml(uncategorized.name) + '</button>';
  }
  html += '<button class="tab-add" id="tabAddBtn" title="创建分类">+</button>';
  tabBarInner.innerHTML = html + '<div class="tab-underline" id="tabUnderline"></div>';
  const underline = document.getElementById('tabUnderline');
  tabBarInner.querySelectorAll('.tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      saveScrollPosition();
      currentCategoryId = btn.dataset.id;
      renderTabs();
      loadDocuments();
      restoreScrollPosition();
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const catId = btn.dataset.id;
      if (!catId) return;
      showTabContextMenu(e.clientX, e.clientY, catId);
    });
    let longPressTimer = null;
    btn.addEventListener('touchstart', (e) => {
      const catId = btn.dataset.id;
      if (!catId) return;
      longPressTimer = setTimeout(() => {
        e.preventDefault();
        showTabContextMenu(e.touches[0].clientX, e.touches[0].clientY, catId);
      }, 600);
    });
    btn.addEventListener('touchend', () => clearTimeout(longPressTimer));
    btn.addEventListener('touchmove', () => clearTimeout(longPressTimer));
  });
  const addBtn = document.getElementById('tabAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showQuickCreate(e.target);
    });
  }
  requestAnimationFrame(() => {
    const activeTab = tabBarInner.querySelector('.tab-item.active');
    if (!activeTab || !underline) return;
    const innerRect = tabBarInner.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    underline.style.left = (tabRect.left - innerRect.left) + 'px';
    underline.style.width = tabRect.width + 'px';
  });
}

// Tab context menu
const tabContextMenu = document.getElementById('tabContextMenu');
let contextCatId = null;

function showTabContextMenu(x, y, catId) {
  contextCatId = catId;
  tabContextMenu.style.left = Math.min(x, window.innerWidth - 150) + 'px';
  tabContextMenu.style.top = Math.min(y, window.innerHeight - 80) + 'px';
  tabContextMenu.classList.add('show');
}

document.addEventListener('click', () => tabContextMenu.classList.remove('show'));

document.getElementById('ctxEdit').addEventListener('click', () => {
  if (!contextCatId) return;
  startEditCat(contextCatId);
});

document.getElementById('ctxDelete').addEventListener('click', () => {
  if (!contextCatId) return;
  deleteCategory(contextCatId);
});

// Quick create category
const quickCreatePopup = document.getElementById('quickCreatePopup');
const quickCatName = document.getElementById('quickCatName');

function showQuickCreate(anchor) {
  const rect = anchor.getBoundingClientRect();
  quickCreatePopup.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
  quickCreatePopup.style.top = (rect.bottom + 8) + 'px';
  quickCreatePopup.classList.add('show');
  quickCatName.value = '';
  quickCatName.focus();
}

document.getElementById('quickCatCancel').addEventListener('click', () => {
  quickCreatePopup.classList.remove('show');
});

document.getElementById('quickCatConfirm').addEventListener('click', async () => {
  const name = quickCatName.value.trim();
  if (!name) return;
  try {
    const data = await apiPost('/api/categories', { name });
    if (data && data.success) {
      quickCreatePopup.classList.remove('show');
      await loadCategories();
      currentCategoryId = data.id;
      renderTabs();
      loadDocuments();
    } else {
      alert(data ? data.error : '创建失败');
    }
  } catch (err) {
    alert('创建失败: ' + err.message);
  }
});

quickCatName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('quickCatConfirm').click();
  if (e.key === 'Escape') quickCreatePopup.classList.remove('show');
});

document.addEventListener('click', (e) => {
  if (!quickCreatePopup.contains(e.target) && e.target.id !== 'tabAddBtn') {
    quickCreatePopup.classList.remove('show');
  }
});

// Recent views
async function loadRecentViews() {
  try {
    const data = await apiGet('/api/recent-views');
    if (!data || data.length === 0) {
      recentSection.style.display = 'none';
      return;
    }
    recentSection.style.display = 'block';
    recentList.innerHTML = data.slice(0, 5).map(v => {
      const catColor = getCatColor(v.category_id);
      return '<a class="recent-item" href="/view/' + v.id + '">' +
        '<span class="recent-item-name">' + escapeHtml(v.original_name) + '</span>' +
        (v.category_name ? '<span class="recent-item-cat" style="background:' + catColor + '12;color:' + catColor + '"><span class="recent-item-cat-dot" style="background:' + catColor + '"></span>' + escapeHtml(v.category_name) + '</span>' : '') +
        '<span class="recent-item-time">' + relativeTime(v.viewed_at) + '</span>' +
        '</a>';
    }).join('');
  } catch (err) {
    recentSection.style.display = 'none';
  }
}

recentHeader.addEventListener('click', () => {
  recentArrow.classList.toggle('open');
  recentList.classList.toggle('open');
});

// Scroll position memory
const SCROLL_KEY_PREFIX = 'md-viewer-scroll-';
let scrollSaveTimer = null;

function getScrollKey() {
  return SCROLL_KEY_PREFIX + (currentCategoryId || 'all');
}

function saveScrollPosition() {
  try {
    const key = getScrollKey();
    localStorage.setItem(key, JSON.stringify({
      scrollY: window.scrollY,
      timestamp: Date.now()
    }));
  } catch (e) { /* ignore */ }
}

function restoreScrollPosition() {
  try {
    const key = getScrollKey();
    const saved = localStorage.getItem(key);
    if (!saved) return;
    const data = JSON.parse(saved);
    if (Date.now() - data.timestamp > 86400000) {
      localStorage.removeItem(key);
      return;
    }
    requestAnimationFrame(() => {
      window.scrollTo(0, data.scrollY);
    });
  } catch (e) { /* ignore */ }
}

window.addEventListener('scroll', () => {
  if (scrollSaveTimer) return;
  scrollSaveTimer = setTimeout(() => {
    saveScrollPosition();
    scrollSaveTimer = null;
  }, 500);
}, { passive: true });

// Resize handler for underline
window.addEventListener('resize', () => {
  const activeTab = tabBarInner.querySelector('.tab-item.active');
  const underline = document.getElementById('tabUnderline');
  if (!activeTab || !underline) return;
  const innerRect = tabBarInner.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  underline.style.left = (tabRect.left - innerRect.left) + 'px';
  underline.style.width = tabRect.width + 'px';
});

// Initialize
(async () => {
  await Promise.all([loadCategories(), loadTags()]);
  await Promise.all([loadDocuments(), loadRecentViews()]);
  restoreScrollPosition();
})();
