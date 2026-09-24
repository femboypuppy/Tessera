# @tessera/server

The Tessera sync and API server: real-time collaboration over WebSocket (Hocuspocus), SQLite
storage, accounts and roles, assets, version history, and the web app itself, all on one port.
**Owner: Agent 03 (Storage & sync).**

Tessera is local-first: every device keeps the full workspace and works offline. The server is
optional; it relays changes between devices and people, and keeps a copy of everything.

## Quick start

```bash
pnpm install
pnpm --filter @tessera/web build          # optional: lets the server serve the web app
DATA_DIR=./data pnpm --filter @tessera/server start
```

The first start prints a **setup code**. Open the server's address in a browser, choose
**Settings → Sync & account → Connect to a server**, enter the address and the setup code, and
create the owner account. On a headless machine, create the owner from the command line instead:

```bash
DATA_DIR=./data node apps/server/dist/main.js create-owner --email you@example.com --name "Your Name"
```

`start` builds `dist/main.js` first (with tsdown) and runs it. In production images run
`node apps/server/dist/main.js` directly.

## Configuration

Everything is configured with environment variables, validated at boot. A bad value stops the
server with a message that names the variable, the problem and the value it got.

| Variable | Default | What it does |
|---|---|---|
| `DATA_DIR` | `./data` | Folder for the database (`tessera.db`), assets (`assets/`) and temporary uploads (`tmp/`). The only setting a first start needs. Back it up. |
| `PORT` | `8787` | Port for HTTP and WebSocket. |
| `HOST` | `0.0.0.0` | Interface to listen on (`127.0.0.1` for local only). |
| `PUBLIC_URL` | none | The address people use, such as `https://notes.example.com`. Used for invite links, marks the session cookie `Secure` when it is `https`, enables HSTS, and is an allowed origin. Set it in production. |
| `MAX_UPLOAD_MB` | `25` | Largest asset upload, in megabytes (at most 2048). |
| `SIGNUP_MODE` | `invite` | `invite`: new accounts need an invite link. `open`: anyone can sign up. `closed`: nobody can sign up, and only the server owner creates workspaces. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are JSON lines (pino), pretty-printed in a terminal during development. |
| `CORS_ORIGINS` | none | Extra browser origins allowed to use the API with credentials and to open cookie-authenticated WebSockets, comma-separated (`http://localhost:5173` for the Vite dev server). The server's own origin, `PUBLIC_URL` and the desktop app are always allowed. |
| `TRUST_PROXY` | `false` | Behind a reverse proxy: trust `X-Forwarded-For` (rate limits, session IPs) and `X-Forwarded-Proto`. |
| `WEB_DIR` | auto | The built web app to serve. By default `apps/web/dist` next to the server; without it, only the API and sync are served. |
| `SESSION_DAYS` | `30` | Sessions expire after this many days without use (each use extends them). |
| `SETUP_CODE` | random | Fixes the first-run setup code (at least 8 characters) instead of a random one printed in the log. Useful for automated deployments. |

## First run, accounts and roles

- **Owner.** The first account is the server owner, created with the setup code (web form) or
  `tessera-server create-owner`. Both refuse once any account exists.
- **Sign-up** follows `SIGNUP_MODE`. Passwords are hashed with argon2id (at least 8 characters).
- **Sessions.** The web app gets an httpOnly, `SameSite=Lax` session cookie (`tessera_session`);
  the desktop app signs in with `"client": "desktop"` and gets a bearer token instead. Only
  SHA-256 hashes of tokens are stored. People can list their devices and sign any of them out;
  signing out closes that device's sync connections at once.
- **Roles** apply to a whole workspace: **owner** (manages members and invites), **editor**
  (writes), **viewer** (reads). Every check happens on the server. Viewers get read-only sync
  connections: the server refuses their document updates, including hand-crafted ones. Changing
  someone's role reconnects them with the new one.
- **Invites** are links with a role, an expiry (1 hour to 90 days, default 7 days) and a number
  of uses (default 1, or unlimited). Owners can revoke them.

## HTTP API

JSON over HTTPS. Errors are `{ "error": { "code", "message", "details"? } }` with a matching
status. Authenticate with the session cookie or `Authorization: Bearer <token>`.

| Method and path | Who | What |
|---|---|---|
| `GET /api/health` | anyone | `{ ok, name: "tessera", version, setupRequired, signupMode, maxUploadBytes }` |
| `POST /api/auth/setup` | first run | `{ setupCode, name, email, password, client?, deviceName? }`: creates the owner and signs in. |
| `POST /api/auth/signup` | per `SIGNUP_MODE` | `{ name, email, password, inviteToken?, client?, deviceName? }` |
| `POST /api/auth/login` | anyone | `{ email, password, client?: "web" \| "desktop", deviceName? }` |
| `POST /api/auth/logout` | signed in | Ends the current session. |
| `GET /api/auth/me`, `PATCH /api/auth/me` | signed in | The account (`{ name }` to rename). |
| `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id` | signed in | Devices and sessions; sign one out. |
| `GET /api/workspaces`, `POST /api/workspaces` | signed in | Your workspaces with your role; create one (`{ id?, name }`: pass the local ID to upload a workspace). |
| `GET`, `PATCH`, `DELETE /api/workspaces/:id` | member, owner, owner | Details; rename; delete everything. |
| `GET /api/workspaces/:id/members` | member | Members and roles (emails for owners). |
| `PATCH`, `DELETE /api/workspaces/:id/members/:userId` | owner (or yourself to leave) | Change a role; remove. A workspace always keeps one owner. |
| `GET /api/workspaces/:id/docs` | member | `{ docs: [{ name, seq, updatedAt }] }`: sequence numbers grow on every change, so clients fetch only what changed. |
| `DELETE /api/workspaces/:id/docs/:docName` | editor | Permanently deletes a page or database doc and its history (a tombstone keeps it from coming back). |
| `GET /api/workspaces/:id/versions?doc=page:<id>` | member | Version history of a page. |
| `GET /api/workspaces/:id/versions/:versionId` | member | One version with its state (base64 Yjs update). |
| `POST /api/workspaces/:id/versions` | editor | `{ id, docName, createdAt, kind: "auto" \| "manual" \| "restore", label?, state }`; idempotent by `id`. The newest 100 automatic versions per page are kept. |
| `GET`, `POST /api/workspaces/:id/invites`, `DELETE …/invites/:inviteId` | owner | Invites (`{ role, expiresInHours?, maxUses? }`). |
| `GET /api/invites/:token`, `POST /api/invites/:token/accept` | anyone, signed in | Preview and accept an invite. |
| `PUT /api/assets/:workspaceId/:assetId` | editor | Upload the raw bytes (`Content-Type`, optional `X-Tessera-Asset-Name`). |
| `GET /api/assets/:workspaceId/:assetId` | member | Download. |

**Assets** are stored at `DATA_DIR/assets/<workspaceId>/<assetId>`. IDs are validated against
strict patterns and paths are checked to stay inside that folder. Uploads stream to a temporary
file and stop at `MAX_UPLOAD_MB`; the type is sniffed from the file's bytes against an allowlist
(images, PDF, audio, video, plain text, Markdown, CSV, JSON, office documents and zip archives;
never HTML or executables); SHA-256 IDs must match the content. Downloads are sent with
`nosniff`, a sandboxing CSP and, for anything other than media, as attachments.

## Real-time sync

WebSocket at `/sync` (Hocuspocus protocol), one connection per device carrying every open doc.
Documents are named `<workspaceId>/<docName>` (`<workspaceId>/page:<pageId>`), so membership of
the workspace authorizes access. Browsers authenticate with the session cookie (only from allowed
origins, against cross-site WebSocket hijacking); other clients send a bearer token in the
Hocuspocus auth message. Sessions are re-checked on every message.

Every update is written to SQLite **before** the server acknowledges it, so an acknowledged
change survives a crash (tested by killing the server process). Docs are compacted (their
updates merged into one) after 200 updates, when they unload and every 10 minutes, inside one
SQLite transaction that nothing can interleave with. Presence (awareness) is never stored; the
server rewrites each presence state's `user` to the signed-in account, so nobody can appear as
someone else.

## Backup and restore

```bash
DATA_DIR=./data node apps/server/dist/main.js backup tessera-2026-09-23.tar.gz   # safe while running
DATA_DIR=./data node apps/server/dist/main.js restore tessera-2026-09-23.tar.gz  # server stopped
```

A backup is a `.tar.gz` with an online SQLite backup (consistent while the server writes) and
every asset. Restore checks the archive (no path may leave `DATA_DIR`), verifies the database's
integrity, and moves the current data to `DATA_DIR/pre-restore-<timestamp>/` before replacing
it, so nothing is ever deleted. A server refuses to start on a `DATA_DIR` another live server
holds (`server.pid`).

## Security

Rate limits on sign-in (30 per 5 minutes per IP, 10 per 5 minutes per account), sign-up, setup and
invite endpoints; security headers on every response (`nosniff`, `X-Frame-Options: DENY`, a strict
`Referrer-Policy`, `Permissions-Policy`, COOP, HSTS behind https, a CSP for the web app);
CORS limited to allowed origins; cookie-authenticated writes must come from an allowed origin
(CSRF); timing-equalized sign-in; credentials redacted from logs.

## Operations

- **Health:** `GET /api/health`.
- **Shutdown:** `SIGINT`/`SIGTERM` stop accepting connections, close sockets, compact busy docs,
  checkpoint the WAL and close the database. A second signal exits at once.
- **Logs:** JSON lines on stdout.

## Development

```bash
pnpm --filter @tessera/server dev         # tsx watch
pnpm --filter @tessera/server build       # dist/main.js (workspace packages bundled in)
pnpm --filter @tessera/server test
pnpm --filter @tessera/server load-test   # 50 simulated clients; see scripts/load-test.ts
```
