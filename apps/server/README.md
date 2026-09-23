# @tessera/server

The Tessera sync and API server. **Owner: Agent 03 (Storage & sync).** This folder is a stub from
the Architect; Agent 03 builds the real server here.

## What it will be

- Hocuspocus WebSocket sync for every doc (`ws:*`, `page:*`, `db:*`), persisted in SQLite
  (better-sqlite3, WAL) with periodic compaction and a graceful shutdown that flushes everything.
- Accounts (argon2id), session cookies for the web app, bearer tokens for the desktop app, invites
  and roles (owner, editor, viewer), enforced on the server.
- An HTTP API (Hono): `/api/health`, `/api/auth/*`, `/api/workspaces`, `/api/invites`, `/api/assets`.
- It serves the built web app, so one container is the whole product.

## What exists now

- `src/app.ts`: a Hono app with `GET /api/health` → `{ "ok": true, "version": "0.0.0" }`.
- `src/main.ts`: starts it on `PORT` (default `8787`).

## Scripts

```bash
pnpm --filter @tessera/server dev     # tsx watch
pnpm --filter @tessera/server build   # tsdown bundle to dist/main.js (workspace packages bundled in)
pnpm --filter @tessera/server start   # node dist/main.js
pnpm --filter @tessera/server test
```

## Configuration

Environment variables are validated with zod at boot (Agent 03 documents each one here):
`PORT`, `DATA_DIR`, `PUBLIC_URL`, `MAX_UPLOAD_MB`, `SIGNUP_MODE=invite|open|closed`, `LOG_LEVEL`.

Pre-installed: `@hocuspocus/server`, `@hocuspocus/extension-database`, `better-sqlite3`, `hono`,
`@hono/node-server`, `argon2`, `pino`, `zod`, `yjs`. Native modules are allowed to build in
`pnpm-workspace.yaml` (`allowBuilds`).
