// Tag management modal logic

const tagModal = document.getElementById('tagModal');
const tagList = document.getElementById('tagList');
const newTagName = document.getElementById('newTagName');
const newTagColor = document.getElementById('newTagColor');
const addTagBtn = document.getElementById('addTagBtn');

document.getElementById('tagMgmtBtn').addEventListener('click', () => {
  renderTagList();
  tagModal.classList.add('active');
});
document.getElementById('tagModalClose').addEventListener('click', () => tagModal.classList.remove('active'));
tagModal.addEventListener('click', (e) => { if (e.target === tagModal) tagModal.classList.remove('active'); });

addTagBtn.addEventListener('click', addTag);
newTagName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

async function addTag() {
  const name = newTagName.value.trim();
  if (!name) return;
  try {
    const data = await apiPost('/api/tags', { name, color: newTagColor.value });
    if (data && data.success) {
      newTagName.value = '';
      await loadTags();
      renderTagList();
    } else {
      alert(data ? data.error : '添加失败');
    }
  } catch (err) {
    alert('添加失败: ' + err.message);
  }
}

function renderTagList() {
  tagList.innerHTML = allTags.map(t =>
    '<li class="tag-mgmt-item" data-id="' + t.id + '">' +
    '<span class="tag-mgmt-item-name" id="tag-name-' + t.id + '">' +
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + t.color + ';margin-right:6px;vertical-align:middle;"></span>' +
    escapeHtml(t.name) + '</span>' +
    '<span class="tag-mgmt-item-count">' + (t.document_count || 0) + ' 篇</span>' +
    '<div class="tag-mgmt-item-actions">' +
    '<button title="编辑" onclick="startEditTag(\'' + t.id + '\')">✎</button>' +
    '<button class="delete" title="删除" onclick="deleteTag(\'' + t.id + '\')">✕</button>' +
    '</div></li>'
  ).join('');
}

window.startEditTag = function(id) {
  const tag = allTags.find(t => t.id === id);
  const nameEl = document.getElementById('tag-name-' + id);
  if (!tag || !nameEl) return;
  const li = nameEl.closest('.tag-mgmt-item');
  nameEl.outerHTML = '<div style="display:flex;align-items:center;gap:6px;flex:1;">' +
    '<input type="color" class="tag-color-input" id="tag-edit-color-' + id + '" value="' + tag.color + '">' +
    '<input class="tag-edit-input" id="tag-edit-' + id + '" value="' + escapeHtml(tag.name) + '"></div>';
  const editInput = document.getElementById('tag-edit-' + id);
  editInput.focus(); editInput.select();
  const saveEdit = async () => {
    const newName = editInput.value.trim();
    const newColor = document.getElementById('tag-edit-color-' + id).value;
    if (!newName) { renderTagList(); return; }
    try {
      await apiPut('/api/tags/' + id, { name: newName, color: newColor });
      await loadTags();
      renderTagList();
    } catch (err) {
      alert('修改失败: ' + err.message);
      renderTagList();
    }
  };
  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') renderTagList();
  });
  editInput.addEventListener('blur', saveEdit);
};

window.deleteTag = async function(id) {
  if (!confirm('确定要删除该标签吗？')) return;
  try {
    await apiDelete('/api/tags/' + id);
    await loadTags();
    renderTagList();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
};