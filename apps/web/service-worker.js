/**
 * Tessera's service worker: the app itself works offline, as its data already does (IndexedDB).
 * The build (`serviceWorker()` in vite.config.ts) prepends `BUILD`: this build's version and every
 * file it emitted, and writes the result to `sw.js`.
 *
 * - Install: caches the app shell (`/`) and every built file, so a cold start works offline.
 * - Pages: network first, so an online reload always gets the latest build; offline, the cached
 *   shell (the app routes on the client).
 * - Built files: cache first (their names are content hashes); files of a newer build that load
 *   while this worker is active are cached as they arrive.
 * - Never touched: other origins, `/api/` and `/sync` (the server), non-GET requests.
 *
 * A new version waits until every tab of the old one is closed, so a running tab never mixes
 * files from two builds.
 */
/* global BUILD -- prepended by the build (vite.config.ts) */
const CACHE = `tessera-${BUILD.version}`;
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const shell = await fetch('/', { cache: 'reload' });
      if (!shell.ok) throw new Error(`The app shell answered ${shell.status}`);
      await cache.put(SHELL, shell);
      await cache.addAll(BUILD.files.map((file) => `/${file}`));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('tessera-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

function isServer(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/sync';
}

async function page(request) {
  try {
    const response = await fetch(request);
    if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(SHELL);
    if (cached) return cached;
    throw error;
  }
}

async function file(request) {
  // Module scripts send `Origin` and servers answer `Vary: Origin`, which the requests made at
  // install don't match: the files are the same for every origin (they are content-hashed).
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname.startsWith('/assets/')) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isServer(url)) return;
  event.respondWith(request.mode === 'navigate' ? page(request) : file(request));
});
