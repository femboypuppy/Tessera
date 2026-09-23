# Agent 03 — Storage & sync

**Parallel phase, branch `feat/sync`. Effort: xhigh.**

You own `packages/sync`, `apps/server`, `apps/web/src/features/sync`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

"Local-first" has to be literally true: Tessera works with no network, never loses a keystroke, and syncs seamlessly with a self-hosted server, including several people editing the same page at once. One data-loss report on launch day undoes everything else. Be paranoid.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: `DocStore`, `AssetStore`, `SyncProvider`, `WorkspaceRegistry`, `AppContext` (the doc handle lifecycle), service resolution and priorities, and `EventBus`.

## M1 — Browser persistence

- `IndexedDbDocStore` implementing `DocStore`: persists every Yjs update immediately, compacts in the background (merging many updates into one state update past a threshold), survives reloads and crashes, and handles storage-quota errors with a clear toast instead of failing silently.
- Multi-tab: two tabs of the same workspace stay in sync without a server (BroadcastChannel), with no duplicate writes.
- `IndexedDbAssetStore` implementing `AssetStore`: blobs stored by content hash (deduplicated), with object URLs revoked when no longer used.
- `IndexedDbWorkspaceRegistry` implementing `WorkspaceRegistry`.
- Register all three as services (priority 50) in your `FeatureModule`, so the shell swaps out the in-memory stubs automatically.

## M2 — Server (`apps/server`)

- Current Node LTS with Hocuspocus for WebSocket sync of every doc (`ws:*`, `page:*`, `db:*`), SQLite persistence (better-sqlite3, WAL mode) storing updates with periodic compaction, and a graceful shutdown that flushes everything.
- **Auth:** accounts with argon2id password hashing; an httpOnly, SameSite session cookie for the web app and bearer tokens for the desktop app; first-run setup that creates the owner (a `tessera-server create-owner` CLI and a first-run web form); invite links; roles owner, editor and viewer. Viewers get read-only connections, enforced **on the server**.
- **HTTP API** (Fastify or Hono): `/api/health`, `/api/auth/*`, `/api/workspaces`, `/api/invites`, and `/api/assets` (upload and download with auth, a size limit, content-type sniffing with an allowlist, and no path traversal).
- The server also serves the built web app, so one container is the whole product.
- Configuration through environment variables (`PORT`, `DATA_DIR`, `PUBLIC_URL`, `MAX_UPLOAD_MB`, `SIGNUP_MODE=invite|open|closed`, `LOG_LEVEL`), validated with zod at boot with human-friendly errors. Document every variable in `apps/server/README.md` (Agent 10 copies it into the docs).
- Rate limiting on auth endpoints, security headers, CORS set up for the desktop app, structured logs (pino).
- `tessera-server backup <file>` and `tessera-server restore <file>` (a consistent SQLite backup plus assets).

## M3 — Client sync

- `HocuspocusSyncProvider` implementing `SyncProvider`, registered as a service: multiplexes all open docs over one WebSocket, reconnects with exponential backoff and jitter, and reports its status.
- Edits made offline sync automatically on reconnect: nothing lost, nothing duplicated, no manual action.
- Awareness: user name and color, cursor and selection data for the editor, and presence avatars showing who else is on the current page (register them in `pageHeaderActions`).
- A sync status indicator in the top bar (`topBarItems`): local only, offline, syncing, synced, or error with details on click.
- A "Sync & account" settings panel: connect a local workspace to a server (URL, then sign in or accept an invite), upload the local workspace to the server, or open a server workspace as a new local one; sign out; list devices and sessions.

## M4 — Version history

- Automatic snapshots per page after a few minutes of editing and on an explicit "Save version", stored locally, and on the server when connected.
- A history side panel (`pageSidePanels`): versions with time and author, a read-only preview, and **Restore**, which replaces the current content with the snapshot's content **as a new edit** (so it syncs to everyone and can be undone). Don't try to rewind the CRDT.
- Permanently deleting a page from the trash deletes its docs and history locally and on the server.

## Acceptance criteria

- A convergence fuzz test: several simulated clients apply random concurrent edits and go offline and online at random, and always converge to the same content.
- Offline edits sync after reconnect with no loss or duplication; a server restart keeps all data; compaction preserves content exactly; restore works and can be undone.
- Auth tests: unauthenticated connections are rejected; viewers can't write, even with a hand-crafted update message; expired sessions are rejected; invite links expire and are single-use when configured that way.
- Asset tests: oversized files, disallowed types, path traversal attempts and unauthenticated access are all rejected.
- e2e in `e2e/sync/`: two browser contexts on the same page see each other's changes and presence within a second (use a minimal test editor or Y.Doc-level assertions if the real editor isn't on your branch, and list the full-editor version as a merge follow-up); reload persistence; offline mode (Playwright network emulation) and back online.
- A load-test script under `apps/server/scripts/` (50 concurrent clients editing), with results in HANDOFF.
- `pnpm --filter @tessera/server start` works with nothing configured except `DATA_DIR`.
- Screenshots (light and dark): `sync-status`, `presence`, `history-panel`, `connect-server`.

## Pitfalls

- Awareness and document updates are different channels. Never persist awareness.
- Compaction must never race with incoming updates. Test it under load.
- Never trust the client for authorization. Every permission check happens on the server.
