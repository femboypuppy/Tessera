import { Hono } from 'hono';

/** Server version reported by the health endpoint. */
export const SERVER_VERSION = '0.0.0';

/**
 * Creates the HTTP app. Agent 03 builds the real server (Hocuspocus, SQLite, auth, assets) on top
 * of this; see README.md.
 */
export function createApp(): Hono {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true, version: SERVER_VERSION }));
  return app;
}
