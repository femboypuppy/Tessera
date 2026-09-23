# Sync handoff

Agent 03 (Storage & sync), branch `feat/sync`. Owns `packages/sync`, `apps/server`,
`apps/web/src/features/sync`, `e2e/sync`, `assets/screenshots/sync`.

## Plan

Milestones from `agents/03-sync.md`, in order. Each ends typechecked, linted, tested and committed.

1. **M1 Browser persistence** (`packages/sync/src/stores`)
   - `IndexedDbDocStore`: one IndexedDB database per workspace; an append-only `updates` store
     (autoIncrement key, `doc` index). Writes are batched per tick into one `strict`-durability
     transaction and resolve only after `complete`. `compact` reads, merges (GC through a scratch
     Y.Doc), deletes and rewrites inside **one** readwrite transaction, so it can never race a
     concurrent write from this tab or another. Background compaction past a threshold.
   - Multi-tab: `watch` over a `BroadcastChannel` per workspace; a tab broadcasts only after its
     write committed, and receivers apply with `STORE_ORIGIN` (the DocManager never re-stores
     them). Messages that arrive while a doc is loading are buffered and replayed to `watch`.
   - Quota errors: detected by name, surfaced through `onStorageError` → a throttled toast from
     the feature's `activate`; the DocManager keeps and retries the failed update.
   - `IndexedDbAssetStore`: SHA-256 content addressing (dedup), ArrayBuffer storage, cached object
     URLs revoked on delete/dispose/release.
   - `IndexedDbWorkspaceRegistry`: registry DB + BroadcastChannel so other tabs see changes;
     `remove` deletes the workspace database.
   - Registered in `features/sync` at priority 50 with dynamic imports.
2. **M2 Server** (`apps/server`): Node 24, Hono + `ws` + Hocuspocus on one HTTP server; SQLite
   (better-sqlite3, WAL) storing every update synchronously as it is applied (so an ack means
   durable), compaction in one transaction; accounts (argon2id), cookie sessions and bearer
   tokens, first-run owner (CLI + setup-code web form), invites, roles enforced in `onAuthenticate`
   (read-only connections) plus re-validation on every message; HTTP API; assets with size limit,
   magic-byte sniffing and allowlist; zod-validated env; pino logs; rate limits; security headers;
   CORS and Origin checks; serves the web build; backup/restore CLI; graceful shutdown.
3. **M3 Client sync** (`packages/sync/src/provider`, `client`, `ui`): `HocuspocusSyncProvider`
   multiplexing every doc over one socket with backoff and jitter; a background replicator that
   pushes docs edited offline (a persisted dirty set) and pulls docs changed on the server, so
   nothing waits for a page to be reopened; awareness with server-rewritten identity; presence
   avatars; top-bar status; "Sync & account" settings (connect, sign in/up, invite accept,
   upload a local workspace, open a server workspace, sessions, members, invites, sign out).
4. **M4 Version history**: automatic snapshots after a few minutes of editing and "Save version",
   stored locally and uploaded when connected; history side panel with preview and Restore as a
   new edit (undo from the toast, and a "Before restore" version); permanent deletion removes
   docs and history locally and on the server (outbox when offline).
5. **Acceptance**: convergence fuzz test, offline/restart/compaction/restore tests, auth and asset
   tests, e2e in `e2e/sync`, load test script with results below, screenshots.

## Built (what exists and where)

(Filled in as milestones land.)

## How it plugs in (FeatureModule entries, services, extension points used)

(Filled in as milestones land.)

## Decisions (and why)

(Filled in as milestones land.)

## Contract change requests (exact proposed diff to packages/core, and why)

(Filled in as needed.)

## Known gaps and bugs

- Pre-existing, not mine: `packages/ui` `EmojiPicker … picks` can time out at 5 s when the whole
  suite runs in parallel on a loaded machine; it passes alone (`pnpm --filter @tessera/ui test`).

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

(Filled in as milestones land.)

## Screenshots (list of files)

(Filled in at the end.)
