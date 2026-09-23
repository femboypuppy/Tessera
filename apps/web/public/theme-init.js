// Runs before the app renders: applies the saved theme so the first paint has the right colors.
// Keep in sync with apps/web/src/app/theme.ts (storage key and values).
(() => {
  let theme = 'system';
  try {
    const saved = window.localStorage.getItem('tessera:device:shell.theme');
    if (saved) theme = JSON.parse(saved);
  } catch {
    theme = 'system';
  }
  const dark =
    theme === 'dark' ||
    (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
