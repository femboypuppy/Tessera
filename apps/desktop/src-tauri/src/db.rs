//! `tessera.db`: one SQLite database per workspace folder.
//!
//! Every Yjs update is one row in `updates` (an append-only log per doc). Loading returns every row
//! of a doc and the TypeScript side merges them (`Y.mergeUpdates`). Compaction replaces the rows up
//! to a sequence number with one merged update inside a transaction, so updates stored while the
//! merge ran are kept (the contract in `packages/core/src/services/doc-store.ts`). Because the
//! whole database is a set of CRDT updates, two copies of it can always be merged by taking the
//! union of their rows (`merge_from`), which is how conflicted copies made by sync services are
//! recovered without losing an edit.

use crate::error::{Error, Result};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DB_FILE: &str = "tessera.db";
pub const ASSETS_DIR: &str = "assets";
/// Bumped when the table layout changes; newer databases are refused with a clear message.
pub const FORMAT_VERSION: i64 = 1;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// How SQLite journals writes. WAL is faster, but a sync client can upload `tessera.db` without
/// its `-wal` file, so folders inside Dropbox, iCloud or OneDrive use a rollback journal, which
/// keeps every committed transaction inside the one database file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JournalMode {
    Wal,
    Delete,
}

/// The identity of a workspace, stored in the folder so it travels with it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub format_version: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetRow {
    pub asset_id: String,
    pub name: Option<String>,
    pub mime_type: String,
    pub size: i64,
    pub created_at: i64,
    /// File name inside `assets/`.
    #[serde(skip)]
    pub file: String,
}

/// What `merge_from` copied.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub docs: usize,
    pub updates: usize,
    pub assets: usize,
}

pub struct WorkspaceDb {
    conn: Connection,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS updates (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  doc TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS updates_by_doc ON updates (doc, seq);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  file TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
";

impl WorkspaceDb {
    /// Opens an existing database, checking that it belongs to `expected_id` (when given).
    pub fn open(folder: &Path, journal: JournalMode, expected_id: Option<&str>) -> Result<Self> {
        let path = folder.join(DB_FILE);
        if !path.is_file() {
            return Err(Error::NotFound(format!(
                "{} has no {DB_FILE}",
                folder.display()
            )));
        }
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let db = WorkspaceDb { conn };
        db.configure(journal)?;
        db.conn.execute_batch(SCHEMA)?;
        let manifest = db.manifest()?;
        if manifest.format_version > FORMAT_VERSION {
            return Err(Error::Unavailable(format!(
                "this workspace was created by a newer version of Tessera (format {}); update the app to open it",
                manifest.format_version
            )));
        }
        if let Some(expected) = expected_id {
            if manifest.id != expected {
                return Err(Error::Conflict(format!(
                    "{} holds another workspace ({})",
                    folder.display(),
                    manifest.name
                )));
            }
        }
        Ok(db)
    }

    /// Creates the folder, `assets/` and a new database for workspace `id`.
    pub fn create(folder: &Path, journal: JournalMode, id: &str, name: &str) -> Result<Self> {
        std::fs::create_dir_all(folder.join(ASSETS_DIR))?;
        let path = folder.join(DB_FILE);
        if path.exists() {
            return Self::open(folder, journal, Some(id));
        }
        let conn = Connection::open(&path)?;
        let db = WorkspaceDb { conn };
        db.configure(journal)?;
        db.conn.execute_batch(SCHEMA)?;
        let tx = db.conn.unchecked_transaction()?;
        for (key, value) in [
            ("workspace_id", id.to_string()),
            ("name", name.to_string()),
            ("created_at", now_ms().to_string()),
            ("format_version", FORMAT_VERSION.to_string()),
        ] {
            tx.execute(
                "INSERT OR IGNORE INTO meta (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        tx.commit()?;
        Ok(db)
    }

    fn configure(&self, journal: JournalMode) -> Result<()> {
        let mode = match journal {
            JournalMode::Wal => "WAL",
            JournalMode::Delete => "DELETE",
        };
        // `synchronous = FULL`: a write is on disk when the command returns ("never lose data").
        self.conn.pragma_update(None, "journal_mode", mode)?;
        self.conn.pragma_update(None, "synchronous", "FULL")?;
        self.conn.pragma_update(None, "foreign_keys", "ON")?;
        self.conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(())
    }

    /// Reads the manifest of any `tessera.db` without changing it (folder inspection).
    pub fn read_manifest(folder: &Path) -> Result<Option<Manifest>> {
        let path = folder.join(DB_FILE);
        if !path.is_file() {
            return Ok(None);
        }
        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let db = WorkspaceDb { conn };
        db.manifest().map(Some)
    }

    pub fn manifest(&self) -> Result<Manifest> {
        let get = |key: &str| self.meta_get(key);
        let id = get("workspace_id")?
            .ok_or_else(|| Error::Invalid(format!("{DB_FILE} has no workspace ID")))?;
        Ok(Manifest {
            id,
            name: get("name")?.unwrap_or_default(),
            created_at: get("created_at")?.and_then(|v| v.parse().ok()).unwrap_or(0),
            format_version: get("format_version")?
                .and_then(|v| v.parse().ok())
                .unwrap_or(1),
        })
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn meta_set(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(value) => self.conn.execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?,
            None => self.conn.execute("DELETE FROM meta WHERE key = ?1", [key])?,
        };
        Ok(())
    }

    /// Every stored update of `doc`, in order, and the highest sequence number (0 when empty).
    pub fn load(&self, doc: &str) -> Result<(i64, Vec<Vec<u8>>)> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT seq, data FROM updates WHERE doc = ?1 ORDER BY seq")?;
        let mut max = 0;
        let mut updates = Vec::new();
        let rows = statement.query_map([doc], |row| Ok((row.get::<_, i64>(0)?, row.get(1)?)))?;
        for row in rows {
            let (seq, data): (i64, Vec<u8>) = row?;
            max = max.max(seq);
            updates.push(data);
        }
        Ok((max, updates))
    }

    /// Appends one update. Durable when it returns (`synchronous = FULL`).
    pub fn store(&self, doc: &str, data: &[u8]) -> Result<i64> {
        if data.is_empty() {
            return Err(Error::Invalid("empty update".into()));
        }
        self.conn
            .prepare_cached("INSERT INTO updates (doc, data, created_at) VALUES (?1, ?2, ?3)")?
            .execute(params![doc, data, now_ms()])?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Replaces the rows of `doc` up to `upto` with `merged`, keeping later rows.
    pub fn compact(&self, doc: &str, upto: i64, merged: &[u8]) -> Result<()> {
        if merged.is_empty() {
            return Err(Error::Invalid("empty compacted update".into()));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM updates WHERE doc = ?1 AND seq <= ?2",
            params![doc, upto],
        )?;
        tx.execute(
            "INSERT INTO updates (doc, data, created_at) VALUES (?1, ?2, ?3)",
            params![doc, merged, now_ms()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_doc(&self, doc: &str) -> Result<usize> {
        Ok(self
            .conn
            .execute("DELETE FROM updates WHERE doc = ?1", [doc])?)
    }

    #[cfg(test)]
    pub fn update_count(&self, doc: &str) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM updates WHERE doc = ?1",
            [doc],
            |row| row.get(0),
        )?)
    }

    /// Doc names starting with `prefix`, sorted.
    pub fn list_docs(&self, prefix: &str) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT DISTINCT doc FROM updates WHERE substr(doc, 1, length(?1)) = ?1 ORDER BY doc",
        )?;
        let rows = statement.query_map([prefix], |row| row.get(0))?;
        Ok(rows.collect::<std::result::Result<Vec<String>, _>>()?)
    }

    pub fn asset(&self, id: &str) -> Result<Option<AssetRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, name, mime, size, file, created_at FROM assets WHERE id = ?1",
                [id],
                asset_row,
            )
            .optional()?)
    }

    pub fn assets(&self) -> Result<Vec<AssetRow>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT id, name, mime, size, file, created_at FROM assets ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([], asset_row)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn insert_asset(&self, row: &AssetRow) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO assets (id, name, mime, size, file, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![row.asset_id, row.name, row.mime_type, row.size, row.file, row.created_at],
        )?;
        Ok(())
    }

    pub fn delete_asset(&self, id: &str) -> Result<Option<AssetRow>> {
        let row = self.asset(id)?;
        if row.is_some() {
            self.conn
                .execute("DELETE FROM assets WHERE id = ?1", [id])?;
        }
        Ok(row)
    }

    /// Copies every update and asset row of another `tessera.db` of the same workspace into this
    /// one. Yjs updates are idempotent, so rows both copies share are harmless duplicates that
    /// the next compaction folds away.
    pub fn merge_from(&self, other: &Path) -> Result<MergeReport> {
        let other_manifest = WorkspaceDb::read_manifest_file(other)?;
        let mine = self.manifest()?;
        if other_manifest.id != mine.id {
            return Err(Error::Conflict(format!(
                "{} belongs to another workspace ({})",
                other.display(),
                other_manifest.name
            )));
        }
        let source = Connection::open_with_flags(other, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let tx = self.conn.unchecked_transaction()?;
        let mut report = MergeReport::default();
        {
            let mut docs = std::collections::BTreeSet::new();
            let mut read =
                source.prepare("SELECT doc, data, created_at FROM updates ORDER BY seq")?;
            let mut write =
                tx.prepare("INSERT INTO updates (doc, data, created_at) VALUES (?1, ?2, ?3)")?;
            let rows = read.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (doc, data, created_at) = row?;
                write.execute(params![doc, data, created_at])?;
                docs.insert(doc);
                report.updates += 1;
            }
            report.docs = docs.len();
            let has_assets: bool = source
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'assets'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map(|count| count > 0)?;
            if has_assets {
                let mut read =
                    source.prepare("SELECT id, name, mime, size, file, created_at FROM assets")?;
                let rows = read.query_map([], asset_row)?;
                for row in rows {
                    let row = row?;
                    let inserted = tx.execute(
                        "INSERT OR IGNORE INTO assets (id, name, mime, size, file, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![row.asset_id, row.name, row.mime_type, row.size, row.file, row.created_at],
                    )?;
                    report.assets += inserted;
                }
            }
        }
        tx.commit()?;
        Ok(report)
    }

    fn read_manifest_file(path: &Path) -> Result<Manifest> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let db = WorkspaceDb { conn };
        db.manifest()
    }

    /// Flushes the WAL into the database file (before the app exits, and before merges).
    pub fn checkpoint(&self) -> Result<()> {
        let mode: String = self
            .conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
        if mode.eq_ignore_ascii_case("wal") {
            self.conn
                .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        }
        Ok(())
    }
}

fn asset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetRow> {
    Ok(AssetRow {
        asset_id: row.get(0)?,
        name: row.get(1)?,
        mime_type: row.get(2)?,
        size: row.get(3)?,
        file: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn creates_opens_and_checks_identity() {
        let dir = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Wal, "ws1", "Apollo").unwrap();
        assert_eq!(db.manifest().unwrap().name, "Apollo");
        assert!(dir.path().join(ASSETS_DIR).is_dir());
        drop(db);
        assert!(WorkspaceDb::open(dir.path(), JournalMode::Wal, Some("ws1")).is_ok());
        let err = WorkspaceDb::open(dir.path(), JournalMode::Wal, Some("other"))
            .err()
            .unwrap();
        assert_eq!(err.code(), "conflict");
        let manifest = WorkspaceDb::read_manifest(dir.path()).unwrap().unwrap();
        assert_eq!(manifest.id, "ws1");
        assert_eq!(manifest.format_version, FORMAT_VERSION);
    }

    #[test]
    fn missing_database_is_not_found() {
        let dir = temp();
        let err = WorkspaceDb::open(dir.path(), JournalMode::Wal, None)
            .err()
            .unwrap();
        assert_eq!(err.code(), "not_found");
        assert!(WorkspaceDb::read_manifest(dir.path()).unwrap().is_none());
    }

    #[test]
    fn refuses_newer_formats() {
        let dir = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Wal, "ws1", "A").unwrap();
        db.meta_set("format_version", Some("99")).unwrap();
        drop(db);
        let err = WorkspaceDb::open(dir.path(), JournalMode::Wal, None)
            .err()
            .unwrap();
        assert_eq!(err.code(), "unavailable");
    }

    #[test]
    fn stores_loads_and_lists() {
        let dir = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Delete, "ws1", "A").unwrap();
        assert_eq!(db.load("page:a").unwrap(), (0, vec![]));
        db.store("page:a", &[1, 2]).unwrap();
        db.store("page:a", &[3]).unwrap();
        db.store("page:b", &[4]).unwrap();
        db.store("ws:ws1", &[5]).unwrap();
        let (max, updates) = db.load("page:a").unwrap();
        assert!(max >= 2);
        assert_eq!(updates, vec![vec![1, 2], vec![3]]);
        assert_eq!(db.list_docs("page:").unwrap(), vec!["page:a", "page:b"]);
        assert_eq!(
            db.list_docs("").unwrap(),
            vec!["page:a", "page:b", "ws:ws1"]
        );
        assert!(db.store("page:a", &[]).is_err());
        assert_eq!(db.delete_doc("page:a").unwrap(), 2);
        assert_eq!(db.load("page:a").unwrap().1.len(), 0);
    }

    #[test]
    fn compaction_keeps_updates_stored_after_the_read() {
        let dir = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Wal, "ws1", "A").unwrap();
        db.store("page:a", &[1]).unwrap();
        db.store("page:a", &[2]).unwrap();
        let (upto, _) = db.load("page:a").unwrap();
        // Stored while the caller was merging.
        db.store("page:a", &[3]).unwrap();
        db.compact("page:a", upto, &[12]).unwrap();
        let (_, updates) = db.load("page:a").unwrap();
        assert_eq!(updates.len(), 2);
        assert!(updates.contains(&vec![12]));
        assert!(updates.contains(&vec![3]));
        assert_eq!(db.update_count("page:a").unwrap(), 2);
    }

    #[test]
    fn assets_roundtrip() {
        let dir = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Wal, "ws1", "A").unwrap();
        let row = AssetRow {
            asset_id: "abc".into(),
            name: Some("moon.png".into()),
            mime_type: "image/png".into(),
            size: 3,
            file: "abc.png".into(),
            created_at: 1,
        };
        db.insert_asset(&row).unwrap();
        db.insert_asset(&row).unwrap();
        assert_eq!(db.assets().unwrap(), vec![row.clone()]);
        assert_eq!(db.asset("abc").unwrap(), Some(row.clone()));
        assert_eq!(db.delete_asset("abc").unwrap(), Some(row));
        assert_eq!(db.asset("abc").unwrap(), None);
    }

    #[test]
    fn merges_a_conflicted_copy() {
        let dir = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Delete, "ws1", "A").unwrap();
        db.store("page:a", &[1]).unwrap();
        // A sync client left a second copy that has an edit this one lacks.
        let copy = dir.path().join("tessera (conflicted copy).db");
        std::fs::copy(dir.path().join(DB_FILE), &copy).unwrap();
        {
            let conn = Connection::open(&copy).unwrap();
            conn.execute(
                "INSERT INTO updates (doc, data, created_at) VALUES ('page:b', x'09', 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO assets (id, name, mime, size, file, created_at) VALUES ('img', NULL, 'image/png', 1, 'img.png', 1)",
                [],
            )
            .unwrap();
        }
        let report = db.merge_from(&copy).unwrap();
        assert_eq!(
            report,
            MergeReport {
                docs: 2,
                updates: 2,
                assets: 1
            }
        );
        assert_eq!(db.load("page:b").unwrap().1, vec![vec![9]]);
        assert_eq!(db.load("page:a").unwrap().1.len(), 2);
        assert!(db.asset("img").unwrap().is_some());
    }

    #[test]
    fn refuses_to_merge_another_workspace() {
        let dir = temp();
        let other = temp();
        let db = WorkspaceDb::create(dir.path(), JournalMode::Wal, "ws1", "A").unwrap();
        drop(WorkspaceDb::create(other.path(), JournalMode::Wal, "ws2", "B").unwrap());
        let err = db.merge_from(&other.path().join(DB_FILE)).err().unwrap();
        assert_eq!(err.code(), "conflict");
    }
}
