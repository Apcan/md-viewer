// Theme management
function getTheme() {
  const saved = localStorage.getItem('md-viewer-theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
  localStorage.setItem('md-viewer-theme', theme);
}

// Initialize theme
applyTheme(getTheme());

// Theme toggle click handler
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  });
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('md-viewer-theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});
