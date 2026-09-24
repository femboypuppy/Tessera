//! Detects folders kept in sync by Dropbox, iCloud Drive, OneDrive, Google Drive and friends, and
//! the "conflicted copies" those services create when two devices write the same file.
//!
//! SQLite inside a synced folder is risky: if two devices write before the service has uploaded
//! the other's changes, the service keeps one file and renames the other. Tessera warns before
//! creating a workspace there, uses a rollback journal instead of WAL in such folders, and offers to
//! merge conflicted copies back (the database is a CRDT update log, so nothing is lost).

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CloudProvider {
    Dropbox,
    Icloud,
    Onedrive,
    GoogleDrive,
    Box,
    Syncthing,
    Nextcloud,
    Pcloud,
    Mega,
    /// A macOS File Provider folder (`~/Library/CloudStorage/...`) we don't recognize.
    CloudStorage,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudInfo {
    pub provider: CloudProvider,
    /// The synced root that contains the folder.
    pub root: String,
}

/// What the detector may look at, so tests can describe any machine.
pub struct Environment<'a> {
    pub home: Option<&'a Path>,
    /// `OneDrive`, `OneDriveConsumer`, `OneDriveCommercial` on Windows.
    pub onedrive_roots: Vec<PathBuf>,
    /// Folders listed in Dropbox's `info.json`.
    pub dropbox_roots: Vec<PathBuf>,
    pub exists: &'a dyn Fn(&Path) -> bool,
}

/// `/`-separated and ASCII-lowercased: byte offsets stay equal to the original string's.
fn lower(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

/// Finds the cloud service syncing `folder` (or one of its parents), if any.
pub fn detect(folder: &Path, env: &Environment<'_>) -> Option<CloudInfo> {
    let found = |provider: CloudProvider, root: &Path| {
        Some(CloudInfo {
            provider,
            root: root.to_string_lossy().into_owned(),
        })
    };
    for root in &env.dropbox_roots {
        if folder.starts_with(root) {
            return found(CloudProvider::Dropbox, root);
        }
    }
    for root in &env.onedrive_roots {
        if folder.starts_with(root) {
            return found(CloudProvider::Onedrive, root);
        }
    }
    if let Some(home) = env.home {
        let icloud = home.join("Library").join("Mobile Documents");
        if folder.starts_with(&icloud) {
            return found(CloudProvider::Icloud, &icloud);
        }
        let storage = home.join("Library").join("CloudStorage");
        if folder.starts_with(&storage) {
            let name = folder
                .strip_prefix(&storage)
                .ok()
                .and_then(|rest| rest.components().next())
                .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let root = storage.join(name.as_str());
            let provider = if name.starts_with("dropbox") {
                CloudProvider::Dropbox
            } else if name.starts_with("onedrive") {
                CloudProvider::Onedrive
            } else if name.starts_with("googledrive") {
                CloudProvider::GoogleDrive
            } else if name.starts_with("box") {
                CloudProvider::Box
            } else if name.starts_with("pcloud") {
                CloudProvider::Pcloud
            } else {
                CloudProvider::CloudStorage
            };
            return found(provider, &root);
        }
    }
    // Marker files in the folder or a parent: Syncthing's `.stfolder`, the Nextcloud and ownCloud
    // desktop clients' `.sync_*.db` / `.owncloudsync.log`, pCloud's and MEGA's debris folders.
    for ancestor in folder.ancestors() {
        if (env.exists)(&ancestor.join(".stfolder")) {
            return found(CloudProvider::Syncthing, ancestor);
        }
        if (env.exists)(&ancestor.join(".owncloudsync.log"))
            || (env.exists)(&ancestor.join(".nextcloudsync.log"))
        {
            return found(CloudProvider::Nextcloud, ancestor);
        }
        if (env.exists)(&ancestor.join(".debris")) {
            return found(CloudProvider::Mega, ancestor);
        }
        if (env.exists)(&ancestor.join(".dropbox")) && ancestor != env.home.unwrap_or(Path::new(""))
        {
            return found(CloudProvider::Dropbox, ancestor);
        }
    }
    // Last resort: well-known folder names anywhere in the path.
    let text = lower(folder);
    let by_name: [(&str, CloudProvider); 8] = [
        ("/dropbox/", CloudProvider::Dropbox),
        ("/dropbox (", CloudProvider::Dropbox),
        ("/onedrive/", CloudProvider::Onedrive),
        ("/onedrive - ", CloudProvider::Onedrive),
        ("/icloud drive/", CloudProvider::Icloud),
        ("/icloudrive/", CloudProvider::Icloud),
        ("/google drive/", CloudProvider::GoogleDrive),
        ("/my drive/", CloudProvider::GoogleDrive),
    ];
    let with_slash = format!("{text}/");
    let original = folder.to_string_lossy();
    for (needle, provider) in by_name {
        if let Some(index) = with_slash.find(needle) {
            // Everything up to the end of the matched folder name (`…/Dropbox`).
            let name_len = needle.trim_end_matches('/').len();
            let end = if needle.ends_with('/') {
                index + name_len
            } else {
                index + needle.len()
            };
            let end = original[end..]
                .find(['/', '\\'])
                .map_or(original.len(), |i| end + i);
            return Some(CloudInfo {
                provider,
                root: original[..end].to_string(),
            });
        }
    }
    None
}

/// The environment of this machine.
pub fn detect_here(folder: &Path, home: Option<&Path>) -> Option<CloudInfo> {
    let mut onedrive_roots = Vec::new();
    for key in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(value) = std::env::var_os(key) {
            if !value.is_empty() {
                onedrive_roots.push(PathBuf::from(value));
            }
        }
    }
    let dropbox_roots = home.map(dropbox_roots).unwrap_or_default();
    let exists = |path: &Path| path.exists();
    detect(
        folder,
        &Environment {
            home,
            onedrive_roots,
            dropbox_roots,
            exists: &exists,
        },
    )
}

/// Reads the folders listed in Dropbox's `info.json` (personal and business accounts).
fn dropbox_roots(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![home.join(".dropbox").join("info.json")];
    for key in ["LOCALAPPDATA", "APPDATA"] {
        if let Some(base) = std::env::var_os(key) {
            candidates.push(PathBuf::from(base).join("Dropbox").join("info.json"));
        }
    }
    let mut roots = Vec::new();
    for file in candidates {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if let Some(accounts) = json.as_object() {
            for account in accounts.values() {
                if let Some(path) = account.get("path").and_then(|p| p.as_str()) {
                    roots.push(PathBuf::from(path));
                }
            }
        }
    }
    roots
}

/// Is `name` a copy of `base` (`tessera.db`) made by a sync service after a conflict?
///
/// Dropbox: `tessera (conflicted copy 2024-05-01).db`, `tessera (Ada's conflicted copy …).db`.
/// OneDrive: `tessera-LAPTOP-1234.db`. iCloud: `tessera 2.db`. Google Drive: `tessera (1).db`.
/// Syncthing: `tessera.sync-conflict-20240501-101500-ABCDEFG.db`.
/// Nextcloud: `tessera (conflicted copy 2024-05-01 101500).db`, `tessera_conflict-….db`.
pub fn is_conflicted_copy(name: &str, base: &str) -> bool {
    let (stem, ext) = match base.rsplit_once('.') {
        Some((stem, ext)) => (stem, format!(".{ext}")),
        None => (base, String::new()),
    };
    let lower_name = name.to_lowercase();
    let stem = stem.to_lowercase();
    let ext = ext.to_lowercase();
    if lower_name == base.to_lowercase()
        || !lower_name.starts_with(&stem)
        || !lower_name.ends_with(&ext)
    {
        return false;
    }
    let middle = &lower_name[stem.len()..lower_name.len() - ext.len()];
    if middle.is_empty() {
        return false;
    }
    if middle.contains("conflicted copy")
        || middle.contains("conflict")
        || middle.contains("case conflict")
    {
        return true;
    }
    // ` 2`, ` (1)`: iCloud and Google Drive duplicates.
    let trimmed = middle.trim_start();
    if middle.starts_with(' ') {
        let digits = trimmed.trim_start_matches('(').trim_end_matches(')');
        if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    // `-COMPUTERNAME`: OneDrive keeps both versions by appending the device name.
    if let Some(device) = middle.strip_prefix('-') {
        return !device.is_empty()
            && device.len() <= 64
            && device
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    }
    false
}

/// Conflicted copies of `tessera.db` in a workspace folder, sorted by name.
pub fn conflicted_copies(folder: &Path, base: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        // SQLite's own side files are not copies.
        .filter(|name| {
            !name.ends_with("-wal") && !name.ends_with("-shm") && !name.ends_with("-journal")
        })
        .filter(|name| is_conflicted_copy(name, base))
        .collect();
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(home: &'a Path, exists: &'a dyn Fn(&Path) -> bool) -> Environment<'a> {
        Environment {
            home: Some(home),
            onedrive_roots: vec![],
            dropbox_roots: vec![],
            exists,
        }
    }

    #[test]
    fn plain_folders_are_not_synced() {
        let home = PathBuf::from("/home/ada");
        let never = |_: &Path| false;
        assert_eq!(
            detect(&home.join("Tessera").join("Work"), &env(&home, &never)),
            None
        );
    }

    #[test]
    fn detects_configured_roots() {
        let home = PathBuf::from("/Users/ada");
        let never = |_: &Path| false;
        let mut e = env(&home, &never);
        e.dropbox_roots = vec![home.join("Work Dropbox")];
        e.onedrive_roots = vec![PathBuf::from("/Users/ada/OneDrive - Contoso")];
        let info = detect(&home.join("Work Dropbox").join("Notes"), &e).unwrap();
        assert_eq!(info.provider, CloudProvider::Dropbox);
        let info = detect(Path::new("/Users/ada/OneDrive - Contoso/Notes"), &e).unwrap();
        assert_eq!(info.provider, CloudProvider::Onedrive);
    }

    #[test]
    fn detects_icloud_and_file_providers() {
        let home = PathBuf::from("/Users/ada");
        let never = |_: &Path| false;
        let e = env(&home, &never);
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs/Notes");
        assert_eq!(detect(&icloud, &e).unwrap().provider, CloudProvider::Icloud);
        let gdrive = home.join("Library/CloudStorage/GoogleDrive-ada@example.com/My Drive/Notes");
        assert_eq!(
            detect(&gdrive, &e).unwrap().provider,
            CloudProvider::GoogleDrive
        );
        let other = home.join("Library/CloudStorage/SomethingElse/Notes");
        assert_eq!(
            detect(&other, &e).unwrap().provider,
            CloudProvider::CloudStorage
        );
    }

    #[test]
    fn detects_marker_files() {
        let home = PathBuf::from("/home/ada");
        let synced = home.join("Sync");
        let marker = synced.join(".stfolder");
        let exists = move |path: &Path| path == marker;
        let info = detect(&home.join("Sync").join("Tessera"), &env(&home, &exists)).unwrap();
        assert_eq!(info.provider, CloudProvider::Syncthing);
        assert_eq!(info.root, synced.to_string_lossy());
    }

    #[test]
    fn detects_by_folder_name() {
        let home = PathBuf::from("/home/ada");
        let never = |_: &Path| false;
        let e = env(&home, &never);
        assert_eq!(
            detect(Path::new("/home/ada/Dropbox/Notes"), &e)
                .unwrap()
                .provider,
            CloudProvider::Dropbox
        );
        let info = detect(Path::new("D:/OneDrive/Notes"), &e).unwrap();
        assert_eq!(info.provider, CloudProvider::Onedrive);
        assert_eq!(info.root, "D:/OneDrive");
        assert_eq!(
            detect(Path::new("G:/My Drive/Notes"), &e).unwrap().provider,
            CloudProvider::GoogleDrive
        );
        assert_eq!(detect(Path::new("/home/ada/Dropboxes/Notes"), &e), None);
    }

    #[test]
    fn recognizes_conflicted_copies() {
        let base = "tessera.db";
        for name in [
            "tessera (conflicted copy 2024-05-01).db",
            "tessera (Ada's conflicted copy 2024-05-01).db",
            "tessera-LAPTOP-1234.db",
            "tessera 2.db",
            "tessera (1).db",
            "tessera.sync-conflict-20240501-101500-ABCDEFG.db",
            "tessera_conflict-20240501-101500.db",
            "Tessera (Case Conflict).db",
        ] {
            assert!(
                is_conflicted_copy(name, base),
                "{name} is a conflicted copy"
            );
        }
        for name in [
            "tessera.db",
            "tessera.db-wal",
            "tessera.dbx",
            "notes.db",
            "tessera.json",
            "tessera-.db",
        ] {
            assert!(
                !is_conflicted_copy(name, base),
                "{name} is not a conflicted copy"
            );
        }
    }

    #[test]
    fn lists_conflicted_copies_in_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "tessera.db",
            "tessera.db-wal",
            "tessera 2.db",
            "tessera (1).db",
            "notes.md",
        ] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        assert_eq!(
            conflicted_copies(dir.path(), "tessera.db"),
            vec!["tessera (1).db", "tessera 2.db"]
        );
    }
}
