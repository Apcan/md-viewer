// Category management modal logic

const catModal = document.getElementById('catModal');
const catList = document.getElementById('catList');
const newCatName = document.getElementById('newCatName');
const addCatBtn = document.getElementById('addCatBtn');
const catSelectModal = document.getElementById('catSelectModal');
const catSelectList = document.getElementById('catSelectList');
const editPermPasswordWrap = document.getElementById('editPermPasswordWrap');
const editPermPassword = document.getElementById('editPermPassword');

document.getElementById('modalClose').addEventListener('click', () => catModal.classList.remove('active'));
catModal.addEventListener('click', (e) => { if (e.target === catModal) catModal.classList.remove('active'); });

addCatBtn.addEventListener('click', addCategory);
newCatName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory(); });

async function addCategory() {
  const name = newCatName.value.trim();
  if (!name) return;
  try {
    const data = await apiPost('/api/categories', { name });
    if (data && data.success) {
      newCatName.value = '';
      await loadCategories();
      renderCatList();
    } else {
      alert(data ? data.error : '添加失败');
    }
  } catch (err) {
    alert('添加失败: ' + err.message);
  }
}

function renderCatList() {
  catList.innerHTML = categories.map(c => {
    const isDefault = c.name === '未分类';
    return '<li class="cat-item" data-id="' + c.id + '">' +
      '<span class="cat-item-name" id="cat-name-' + c.id + '">' + escapeHtml(c.name) + '</span>' +
      '<div class="cat-item-actions">' +
      (isDefault ? '' : '<button title="编辑" onclick="startEditCat(\'' + c.id + '\')">✎</button>') +
      (isDefault ? '' : '<button class="delete" title="删除" onclick="deleteCategory(\'' + c.id + '\')">✕</button>') +
      '</div></li>';
  }).join('');
}

window.startEditCat = function(id) {
  const nameEl = document.getElementById('cat-name-' + id);
  const cat = categories.find(c => c.id === id);
  if (!cat || !nameEl) return;
  nameEl.outerHTML = '<input class="cat-edit-input" id="cat-edit-' + id + '" value="' + escapeHtml(cat.name) + '">';
  const editInput = document.getElementById('cat-edit-' + id);
  editInput.focus();
  editInput.select();

  const saveEdit = async () => {
    const newName = editInput.value.trim();
    if (!newName || newName === cat.name) {
      renderCatList();
      return;
    }
    try {
      const data = await apiPut('/api/categories/' + id, { name: newName });
      if (data && data.success) {
        await loadCategories();
        renderCatList();
      } else {
        alert(data ? data.error : '修改失败');
        renderCatList();
      }
    } catch (err) {
      alert('修改失败: ' + err.message);
      renderCatList();
    }
  };
  editInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') renderCatList(); });
  editInput.addEventListener('blur', saveEdit);
};

window.deleteCategory = async function(id) {
  if (!confirm('确定要删除该分类吗？其中的文档将移入"未分类"。')) return;
  try {
    const data = await apiDelete('/api/categories/' + id);
    if (data && data.success) {
      if (currentCategoryId === id) currentCategoryId = '';
      await loadCategories();
      renderCatList();
      loadDocuments();
    } else {
      alert(data ? data.error : '删除失败');
    }
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
};

// Edit document modal (category + permission)
function openCatSelect(docId) {
  editingDocId = docId;
  const doc = allDocuments.find(d => d.id === docId);
  const currentCat = doc ? doc.category_id : null;
  const currentPerm = doc ? (doc.view_permission || 'public') : 'public';

  catSelectList.innerHTML = categories.map(c => {
    const color = getCatColor(c.id);
    const isSelected = c.id === currentCat;
    return '<li class="cat-select-item' + (isSelected ? ' selected' : '') + '" data-id="' + c.id + '">' +
      '<span class="cat-select-dot" style="background:' + color + '"></span>' +
      '<span>' + escapeHtml(c.name) + '</span>' +
      '<span class="cat-select-check">✓</span>' +
      '</li>';
  }).join('');

  catSelectList.querySelectorAll('.cat-select-item').forEach(item => {
    item.addEventListener('click', () => {
      catSelectList.querySelectorAll('.cat-select-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
    });
  });

  const permRadio = document.querySelector('input[name="editPermRadio"][value="' + currentPerm + '"]');
  if (permRadio) permRadio.checked = true;
  editPermPasswordWrap.style.display = currentPerm === 'password' ? 'block' : 'none';
  editPermPassword.value = '';

  const descTextarea = document.getElementById('editDocDescription');
  descTextarea.value = doc ? (doc.description || '') : '';

  const tagCheckboxes = document.getElementById('editTagCheckboxes');
  const docTagIds = (doc && doc.tags) ? doc.tags.map(t => t.id) : [];
  tagCheckboxes.innerHTML = allTags.map(t => {
    const checked = docTagIds.includes(t.id) ? ' checked' : '';
    return '<label class="tag-checkbox-item">' +
      '<input type="checkbox" value="' + t.id + '"' + checked + '>' +
      '<span class="tag-checkbox-dot" style="background:' + t.color + '"></span>' +
      escapeHtml(t.name) + '</label>';
  }).join('');

  catSelectModal.classList.add('active');
}

document.querySelectorAll('input[name="editPermRadio"]').forEach(radio => {
  radio.addEventListener('change', () => {
    editPermPasswordWrap.style.display = radio.value === 'password' && radio.checked ? 'block' : 'none';
  });
});

document.getElementById('catSelectClose').addEventListener('click', () => {
  catSelectModal.classList.remove('active');
});
document.getElementById('editModalCancelBtn').addEventListener('click', () => {
  catSelectModal.classList.remove('active');
});
catSelectModal.addEventListener('click', (e) => {
  if (e.target === catSelectModal) catSelectModal.classList.remove('active');
});

document.getElementById('editModalSaveBtn').addEventListener('click', async () => {
  if (!editingDocId) return;
  const selectedCat = catSelectList.querySelector('.cat-select-item.selected');
  const categoryId = selectedCat ? selectedCat.dataset.id : null;
  const permValue = document.querySelector('input[name="editPermRadio"]:checked').value;
  const permPassword = editPermPassword.value.trim();

  try {
    const catData = await apiPut('/api/documents/' + editingDocId + '/category', { category_id: categoryId });
    if (!catData || !catData.success) {
      alert('更新分类失败: ' + (catData ? catData.error : 'Unknown error'));
      return;
    }

    const permBody = { view_permission: permValue };
    if (permValue === 'password' && permPassword) {
      permBody.view_password = permPassword;
    }
    const permData = await apiPut('/api/documents/' + editingDocId + '/permission', permBody);
    if (!permData || !permData.success) {
      alert('更新权限失败: ' + (permData ? permData.error : 'Unknown error'));
      return;
    }

    const newDesc = document.getElementById('editDocDescription').value.trim();
    await apiPut('/api/documents/' + editingDocId + '/description', { description: newDesc || null });

    const selectedTagIds = Array.from(document.querySelectorAll('#editTagCheckboxes input:checked')).map(cb => cb.value);
    await apiPut('/api/documents/' + editingDocId + '/tags', { tag_ids: selectedTagIds });

    catSelectModal.classList.remove('active');
    await loadCategories();
    loadDocuments();
  } catch (err) {
    alert('更新失败: ' + err.message);
  }
});
