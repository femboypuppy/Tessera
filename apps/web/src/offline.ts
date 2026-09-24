/**
 * Registers the service worker (`service-worker.js`, built as `/sw.js`) so the app itself starts
 * offline, as its data already does. Production builds on http(s) only: the dev server has no
 * `sw.js`, and the desktop app loads its files from disk.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if ('__TAURI_INTERNALS__' in window || !/^https?:$/.test(location.protocol)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // The app works without it; only a cold start while offline doesn't.
      console.warn('[tessera] offline support is unavailable:', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
