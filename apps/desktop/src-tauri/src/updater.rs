//! Updates from GitHub Releases (`latest.json` written by the release workflow), verified with
//! the minisign public key in `tauri.conf.json`. Builds made without a real key (local builds,
//! forks) report "not configured" instead of failing.

use crate::error::{Error, Result};
use crate::lifecycle;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// The value committed in `tauri.conf.json`; the release workflow replaces it.
pub const PLACEHOLDER_PUBKEY: &str = "REPLACE_WITH_TAURI_SIGNING_PUBLIC_KEY";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub configured: bool,
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

pub fn configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| !key.trim().is_empty() && key != PLACEHOLDER_PUBKEY)
}

fn updater_error(error: tauri_plugin_updater::Error) -> Error {
    Error::Unavailable(format!("update check failed: {error}"))
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<UpdateInfo> {
    let current_version = app.package_info().version.to_string();
    if !configured(app) {
        return Ok(UpdateInfo {
            configured: false,
            available: false,
            current_version,
            version: None,
            notes: None,
            date: None,
        });
    }
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?;
    Ok(match update {
        Some(update) => UpdateInfo {
            configured: true,
            available: true,
            current_version,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        },
        None => UpdateInfo {
            configured: true,
            available: false,
            current_version,
            version: None,
            notes: None,
            date: None,
        },
    })
}

/// Downloads (and verifies) the update, then flushes and closes everything before installing it
/// and restarting. On Windows the installer takes over and restarts the app itself.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if !configured(app) {
        return Err(Error::Unavailable(
            "updates are not configured in this build".into(),
        ));
    }
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?
        .ok_or_else(|| Error::NotFound("no update available".into()))?;
    let emitter = app.clone();
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = emitter.emit("desktop://update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(updater_error)?;
    lifecycle::shutdown(app, move |app| {
        if let Err(error) = update.install(bytes) {
            log::error!("installing the update failed: {error}");
        }
        // Relaunch either way: on failure the current version starts again, with its data safe.
        app.restart();
    });
    Ok(())
}
