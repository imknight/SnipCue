(() => {
  try {
    const theme = localStorage.getItem('snipcue-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="color-scheme"]').content = theme;
    }
  } catch { /* Use the system theme when site storage is unavailable. */ }
})();
