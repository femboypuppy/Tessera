import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * The web app's Content-Security-Policy. `connect-src` allows other servers because a workspace
 * may sync with a different Tessera server than the one serving the app.
 */
export const WEB_APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http: https:",
  "frame-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Finds the built web app: `WEB_DIR`, else `apps/web/dist` next to this server. */
export function resolveWebDir(configured: string | null): string | null {
  if (configured) return existsSync(path.join(configured, 'index.html')) ? configured : null;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // From src/http (tsx) or dist (the bundle) back to apps/, then web/dist.
  for (const candidate of [
    path.resolve(here, '../../../web/dist'),
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../web'),
  ]) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

/**
 * Serves the web app (a single-page app): real files by path, `index.html` for every other page
 * route. Paths are resolved inside `root` only.
 */
export function serveWebApp(root: string, csp: string = WEB_APP_CSP): MiddlewareHandler<AppEnv> {
  const base = path.resolve(root);
  const index = path.join(base, 'index.html');
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const requestPath = c.req.path;
    if (requestPath.startsWith('/api/') || requestPath === '/sync') return next();
    let decoded: string;
    try {
      decoded = decodeURIComponent(requestPath);
    } catch {
      return c.text('Bad request', 400);
    }
    if (decoded.includes('\0')) return c.text('Bad request', 400);
    const candidate = path.resolve(base, `.${path.posix.normalize(decoded)}`);
    const inside = candidate === base || candidate.startsWith(base + path.sep);
    let file = inside ? candidate : null;
    if (file) {
      try {
        if (!statSync(file).isFile()) file = null;
      } catch {
        file = null;
      }
    }
    // Missing files with an extension are real 404s; everything else is a page of the app.
    if (!file) {
      if (path.extname(decoded)) return c.text('Not found', 404);
      file = index;
    }
    const extension = path.extname(file).toLowerCase();
    const headers = new Headers({
      'Content-Type': TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': String(statSync(file).size),
    });
    if (file === index) {
      headers.set('Cache-Control', 'no-cache');
      headers.set('Content-Security-Policy', csp);
    } else if (decoded.startsWith('/assets/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      headers.set('Cache-Control', 'public, max-age=3600');
    }
    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, {
      status: 200,
      headers,
    });
  };
}
