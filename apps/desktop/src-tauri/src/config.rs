//! Files in the app's config folder: the recent-workspaces registry (`workspaces.json`), device
//! preferences (`preferences.json`) and the list of servers with a token in the keychain
//! (`servers.json`, no secrets). Every write goes to a temporary file that is synced and renamed
//! over the old one, so a crash never leaves a half-written file.

use crate::db::{now_ms, DB_FILE};
use crate::error::{Error, Result};
use crate::validate;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| Error::Invalid(format!("no parent folder for {}", path.display())))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        std::process::id()
    ));
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<Option<T>> {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(value) => Ok(Some(value)),
            Err(error) => {
                // Keep the unreadable file for recovery instead of overwriting it.
                let backup = path.with_extension(format!("corrupt-{}.json", now_ms()));
                log::error!(
                    "{} is unreadable ({error}); moved to {}",
                    path.display(),
                    backup.display()
                );
                let _ = std::fs::rename(path, &backup);
                Ok(Some(T::default()))
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

/// One workspace this device knows (`WorkspaceInfo` in `@tessera/core`, with a required path).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    pub path: String,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<i64>,
    /// Set once `tessera.db` exists in the folder. A workspace that was never written to has no
    /// folder yet; one whose folder disappeared after that is "missing".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initialized_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FolderStatus {
    /// `tessera.db` exists.
    Ready,
    /// Never written to yet: the folder is created on the first edit.
    New,
    /// It existed once and is gone (moved, deleted, or on an unplugged drive).
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItem {
    #[serde(flatten)]
    pub entry: RegistryEntry,
    pub status: FolderStatus,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RegistryFile {
    version: u32,
    workspaces: Vec<RegistryEntry>,
}

pub struct Registry {
    file: PathBuf,
    entries: Vec<RegistryEntry>,
}

impl Registry {
    /// Loads the registry. On first run (no file yet) it adopts workspaces already in
    /// `default_root` (`~/Tessera`), so reinstalling the app finds them again.
    pub fn load(file: PathBuf, default_root: Option<&Path>) -> Result<Self> {
        let loaded: Option<RegistryFile> = read_json(&file)?;
        let first_run = loaded.is_none();
        let mut registry = Registry {
            file,
            entries: loaded.unwrap_or_default().workspaces,
        };
        registry
            .entries
            .retain(|entry| validate_entry(entry).is_ok());
        if first_run {
            if let Some(root) = default_root {
                registry.adopt_existing(root);
            }
        }
        Ok(registry)
    }

    fn adopt_existing(&mut self, root: &Path) {
        let Ok(children) = std::fs::read_dir(root) else {
            return;
        };
        for child in children.filter_map(|c| c.ok()) {
            let folder = child.path();
            let Ok(Some(manifest)) = crate::db::WorkspaceDb::read_manifest(&folder) else {
                continue;
            };
            if validate::id(&manifest.id).is_err()
                || self.entries.iter().any(|e| e.id == manifest.id)
            {
                continue;
            }
            let name = if manifest.name.trim().is_empty() {
                folder
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            } else {
                manifest.name.clone()
            };
            self.entries.push(RegistryEntry {
                id: manifest.id,
                name,
                icon: None,
                server_url: None,
                path: folder.to_string_lossy().into_owned(),
                created_at: manifest.created_at,
                last_opened_at: None,
                initialized_at: Some(now_ms()),
            });
        }
    }

    fn save(&self) -> Result<()> {
        let file = RegistryFile {
            version: 1,
            workspaces: self.entries.clone(),
        };
        write_atomic(&self.file, &serde_json::to_vec_pretty(&file)?)
    }

    pub fn items(&self) -> Vec<RegistryItem> {
        self.entries
            .iter()
            .map(|entry| {
                let status = if Path::new(&entry.path).join(DB_FILE).is_file() {
                    FolderStatus::Ready
                } else if entry.initialized_at.is_some() {
                    FolderStatus::Missing
                } else {
                    FolderStatus::New
                };
                RegistryItem {
                    entry: entry.clone(),
                    status,
                }
            })
            .collect()
    }

    #[cfg(test)]
    pub fn get(&self, id: &str) -> Option<&RegistryEntry> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    pub fn upsert(&mut self, entry: RegistryEntry) -> Result<()> {
        validate_entry(&entry)?;
        let duplicate_path = self.entries.iter().find(|other| {
            other.id != entry.id && same_folder(Path::new(&other.path), Path::new(&entry.path))
        });
        if let Some(other) = duplicate_path {
            return Err(Error::Conflict(format!(
                "{} is already the folder of workspace \"{}\"",
                entry.path, other.name
            )));
        }
        match self.entries.iter_mut().find(|other| other.id == entry.id) {
            Some(existing) => *existing = entry,
            None => self.entries.push(entry),
        }
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> Result<()> {
        let before = self.entries.len();
        self.entries.retain(|entry| entry.id != id);
        if self.entries.len() == before {
            return Err(Error::NotFound(format!(
                "workspace {id} is not in the list"
            )));
        }
        self.save()
    }

    /// Marks a workspace as opened now (strictly increasing, so the order is never ambiguous).
    pub fn touch(&mut self, id: &str) -> Result<RegistryEntry> {
        let latest = self
            .entries
            .iter()
            .filter_map(|e| e.last_opened_at)
            .max()
            .unwrap_or(0);
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or_else(|| Error::NotFound(format!("workspace {id} is not in the list")))?;
        entry.last_opened_at = Some(now_ms().max(latest + 1));
        let result = entry.clone();
        self.save()?;
        Ok(result)
    }

    /// Records that the workspace's folder now holds its database.
    pub fn mark_initialized(&mut self, id: &str) -> Result<()> {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) {
            if entry.initialized_at.is_none() {
                entry.initialized_at = Some(now_ms());
                self.save()?;
            }
        }
        Ok(())
    }
}

fn same_folder(a: &Path, b: &Path) -> bool {
    let normalize = |p: &Path| {
        let text = p.to_string_lossy().replace('\\', "/");
        let trimmed = text.trim_end_matches('/').to_string();
        if cfg!(any(windows, target_os = "macos")) {
            trimmed.to_lowercase()
        } else {
            trimmed
        }
    };
    normalize(a) == normalize(b)
}

fn validate_entry(entry: &RegistryEntry) -> Result<()> {
    validate::id(&entry.id)?;
    let name = entry.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(Error::Invalid(
            "workspace names must have 1 to 100 characters".into(),
        ));
    }
    validate::absolute_folder(&entry.path)?;
    if let Some(url) = &entry.server_url {
        let parsed = url::Url::parse(url)
            .map_err(|_| Error::Invalid(format!("invalid server URL {url:?}")))?;
        if !matches!(parsed.scheme(), "https" | "http") {
            return Err(Error::Invalid(format!(
                "server URLs must use https: {url:?}"
            )));
        }
    }
    if let Some(icon) = &entry.icon {
        if icon.chars().count() > 16 {
            return Err(Error::Invalid("workspace icons are one emoji".into()));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

pub const DEFAULT_CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

/// Device preferences the Rust side needs before any webview runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Closing the main window hides it (quick capture and the tray keep working).
    pub close_to_tray: bool,
    pub capture_enabled: bool,
    pub capture_shortcut: String,
    /// Webview zoom factor, 0.5 to 2.
    pub zoom: f64,
    /// Check GitHub Releases for updates once a day.
    pub check_updates: bool,
    /// The last time the updater checked (ms since epoch).
    pub last_update_check: Option<i64>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            close_to_tray: true,
            capture_enabled: true,
            capture_shortcut: DEFAULT_CAPTURE_SHORTCUT.into(),
            zoom: 1.0,
            check_updates: true,
            last_update_check: None,
        }
    }
}

impl Prefs {
    pub fn load(file: &Path) -> Result<Self> {
        let mut prefs: Prefs = read_json(file)?.unwrap_or_default();
        prefs.zoom = clamp_zoom(prefs.zoom);
        if prefs.capture_shortcut.trim().is_empty() {
            prefs.capture_shortcut = DEFAULT_CAPTURE_SHORTCUT.into();
        }
        Ok(prefs)
    }

    pub fn save(&self, file: &Path) -> Result<()> {
        write_atomic(file, &serde_json::to_vec_pretty(self)?)
    }
}

pub fn clamp_zoom(zoom: f64) -> f64 {
    if zoom.is_finite() {
        (zoom * 10.0).round().clamp(5.0, 20.0) / 10.0
    } else {
        1.0
    }
}

/// A partial update of [`Prefs`] from the settings panel.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefsPatch {
    pub close_to_tray: Option<bool>,
    pub capture_enabled: Option<bool>,
    pub capture_shortcut: Option<String>,
    pub check_updates: Option<bool>,
}

// ---------------------------------------------------------------------------------------------
// Servers with a stored token (the tokens themselves live in the OS keychain)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub server: String,
    pub saved_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServersFile {
    pub servers: Vec<ServerEntry>,
}

impl ServersFile {
    pub fn load(file: &Path) -> Result<Self> {
        Ok(read_json(file)?.unwrap_or_default())
    }

    pub fn save(&self, file: &Path) -> Result<()> {
        write_atomic(file, &serde_json::to_vec_pretty(self)?)
    }
}

/// The keychain account for a server: its origin (`https://notes.example.com`), so paths and
/// trailing slashes never create two entries for one server.
pub fn server_origin(server: &str) -> Result<String> {
    let url = url::Url::parse(server)
        .map_err(|_| Error::Invalid(format!("invalid server URL {server:?}")))?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err(Error::Invalid(format!("invalid server URL {server:?}")));
    }
    Ok(url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, path: &Path) -> RegistryEntry {
        RegistryEntry {
            id: id.into(),
            name: format!("Workspace {id}"),
            icon: None,
            server_url: None,
            path: path.to_string_lossy().into_owned(),
            created_at: 1,
            last_opened_at: None,
            initialized_at: None,
        }
    }

    #[test]
    fn registry_roundtrip_and_status() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config").join("workspaces.json");
        let mut registry = Registry::load(file.clone(), None).unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        registry.upsert(entry("a", &a)).unwrap();
        registry.upsert(entry("b", &b)).unwrap();
        assert_eq!(registry.items()[0].status, FolderStatus::New);
        drop(crate::db::WorkspaceDb::create(&a, crate::db::JournalMode::Wal, "a", "A").unwrap());
        registry.mark_initialized("a").unwrap();
        registry.mark_initialized("b").unwrap();
        let reloaded = Registry::load(file, None).unwrap();
        let statuses: Vec<_> = reloaded.items().iter().map(|item| item.status).collect();
        assert_eq!(statuses, vec![FolderStatus::Ready, FolderStatus::Missing]);
    }

    #[test]
    fn touch_is_strictly_increasing() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = Registry::load(dir.path().join("w.json"), None).unwrap();
        registry.upsert(entry("a", &dir.path().join("a"))).unwrap();
        registry.upsert(entry("b", &dir.path().join("b"))).unwrap();
        let first = registry.touch("a").unwrap().last_opened_at.unwrap();
        let second = registry.touch("b").unwrap().last_opened_at.unwrap();
        assert!(second > first);
        assert!(registry.touch("missing").is_err());
    }

    #[test]
    fn rejects_bad_entries_and_shared_folders() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = Registry::load(dir.path().join("w.json"), None).unwrap();
        let folder = dir.path().join("shared");
        registry.upsert(entry("a", &folder)).unwrap();
        assert_eq!(
            registry.upsert(entry("b", &folder)).err().unwrap().code(),
            "conflict"
        );
        let mut bad = entry("c", &dir.path().join("c"));
        bad.path = "relative".into();
        assert!(registry.upsert(bad).is_err());
        let mut unnamed = entry("d", &dir.path().join("d"));
        unnamed.name = "  ".into();
        assert!(registry.upsert(unnamed).is_err());
        let mut ftp = entry("e", &dir.path().join("e"));
        ftp.server_url = Some("ftp://example.com".into());
        assert!(registry.upsert(ftp).is_err());
        assert!(registry.remove("zzz").is_err());
        registry.remove("a").unwrap();
        assert!(registry.get("a").is_none());
    }

    #[test]
    fn first_run_adopts_existing_workspaces() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Tessera");
        drop(
            crate::db::WorkspaceDb::create(
                &root.join("Apollo"),
                crate::db::JournalMode::Wal,
                "ws1",
                "Apollo",
            )
            .unwrap(),
        );
        std::fs::create_dir_all(root.join("not a workspace")).unwrap();
        let registry = Registry::load(dir.path().join("w.json"), Some(&root)).unwrap();
        let items = registry.items();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].entry.name, "Apollo");
        assert_eq!(items[0].status, FolderStatus::Ready);
    }

    #[test]
    fn corrupt_files_are_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("preferences.json");
        std::fs::write(&file, b"{not json").unwrap();
        let prefs = Prefs::load(&file).unwrap();
        assert_eq!(prefs, Prefs::default());
        let leftovers = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(leftovers, 1, "the unreadable file is kept as a backup");
    }

    #[test]
    fn prefs_defaults_and_zoom() {
        assert_eq!(clamp_zoom(3.0), 2.0);
        assert_eq!(clamp_zoom(0.1), 0.5);
        assert_eq!(clamp_zoom(1.26), 1.3);
        assert_eq!(clamp_zoom(f64::NAN), 1.0);
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("p.json");
        let mut prefs = Prefs::load(&file).unwrap();
        assert!(prefs.close_to_tray && prefs.capture_enabled);
        prefs.zoom = 1.2;
        prefs.save(&file).unwrap();
        assert_eq!(Prefs::load(&file).unwrap().zoom, 1.2);
    }

    #[test]
    fn server_origins() {
        assert_eq!(
            server_origin("https://notes.example.com/path/").unwrap(),
            "https://notes.example.com"
        );
        assert_eq!(
            server_origin("http://localhost:8787").unwrap(),
            "http://localhost:8787"
        );
        assert!(server_origin("file:///etc/passwd").is_err());
        assert!(server_origin("not a url").is_err());
    }
}
