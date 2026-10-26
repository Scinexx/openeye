// Applies the saved theme before the page is drawn, so it never flashes the default.
try {
  const theme = localStorage.getItem('theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch { /* storage unavailable: default theme */ }
