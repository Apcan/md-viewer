// Unified API fetch wrapper with 401 handling

async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);

    // Handle 401 unauthorized
    if (res.status === 401) {
      localStorage.removeItem('md-viewer-password');
      window.location.href = '/login';
      return null;
    }

    return res;
  } catch (err) {
    console.error('API fetch error:', err);
    throw err;
  }
}

async function apiGet(url) {
  const res = await apiFetch(url);
  if (!res) return null;
  return res.json();
}

async function apiPost(url, data) {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res) return null;
  return res.json();
}

async function apiPut(url, data) {
  const res = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res) return null;
  return res.json();
}

async function apiDelete(url) {
  const res = await apiFetch(url, { method: 'DELETE' });
  if (!res) return null;
  return res.json();
}
