import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** File name of the database inside `DATA_DIR`. */
export const DB_FILE = 'tessera.db';

/**
 * Schema migrations, applied in order inside one transaction each. Never edit a released
 * migration: add a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_owner INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('cookie', 'bearer')),
    device_name TEXT,
    user_agent TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX members_user ON members(user_id);

  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER
  );
  CREATE INDEX invites_workspace ON invites(workspace_id);

  CREATE TABLE docs (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, name)
  );

  CREATE TABLE doc_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    doc_name TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX doc_updates_doc ON doc_updates(workspace_id, doc_name, id);

  CREATE TABLE deleted_docs (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, name)
  );

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    doc_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    author_name TEXT,
    label TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('auto', 'manual', 'restore')),
    state BLOB NOT NULL,
    size INTEGER NOT NULL
  );
  CREATE INDEX versions_doc ON versions(workspace_id, doc_name, created_at);

  CREATE TABLE assets (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    name TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, asset_id)
  );

  CREATE TABLE server_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

/** Opens (creating if needed) the database in `dataDir`, in WAL mode, and migrates it. */
export function openDatabase(dataDir: string, file: string = DB_FILE): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, file));
  configure(db);
  migrate(db);
  return db;
}

/** An in-memory database (tests). */
export function openMemoryDatabase(): Db {
  const db = new Database(':memory:');
  configure(db);
  migrate(db);
  return db;
}

function configure(db: Db): void {
  db.pragma('journal_mode = WAL');
  // WAL + NORMAL survives process crashes; only an OS crash can lose the newest commits, and
  // clients keep every change locally and resend whatever the server is missing on reconnect.
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    { version: number | null } | undefined;
  const current = row?.version ?? 0;
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1;
    if (version <= current) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    })();
  });
}

/** Reads a server setting. */
export function getServerSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

/** Writes (or deletes, with null) a server setting. */
export function setServerSetting(db: Db, key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM server_settings WHERE key = ?').run(key);
  else
    db.prepare(
      'INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}
