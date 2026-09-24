/**
 * `pnpm dev`: the server behind the web app's dev server, which proxies `/api` and `/sync` here
 * (`apps/web/vite.config.ts`), so the app at http://localhost:5173 finds "this server" as it does
 * when a server serves the app. Environment variables still win; data goes to `apps/server/data`.
 */
process.env.PUBLIC_URL ??= 'http://localhost:5173';
process.env.HOST ??= '127.0.0.1';
process.env.DATA_DIR ??= './data';

await import('./main');
