//! Process-wide state shared by commands, menus, the tray and the asset protocol.

use crate::config::{Prefs, Registry};
use crate::deeplink::DeepLink;
use crate::error::{poisoned, Result};
use crate::workspace::Workspaces;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const MAIN_WINDOW: &str = "main";
pub const CAPTURE_WINDOW: &str = "capture";

pub struct Paths {
    pub registry: PathBuf,
    pub prefs: PathBuf,
    pub servers: PathBuf,
    /// `~/Tessera`: new workspaces go here unless the user picks another folder. It is outside
    /// the folders cloud services sync by default (Desktop, Documents).
    pub default_root: Option<PathBuf>,
}

pub struct AppState {
    pub workspaces: Workspaces,
    pub registry: Mutex<Registry>,
    pub prefs: Mutex<Prefs>,
    pub paths: Paths,
    pub pending_links: Mutex<Vec<DeepLink>>,
    pub shortcut_error: Mutex<Option<String>>,
    /// Serializes read-modify-write of `servers.json`.
    pub servers_lock: Mutex<()>,
    pub exit: ExitState,
}

#[derive(Default)]
pub struct ExitState {
    /// Every window flushed and every database closed: exiting is safe now.
    pub ready: AtomicBool,
    pub in_progress: AtomicBool,
    pub acks: Mutex<Option<mpsc::Sender<String>>>,
}

impl ExitState {
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
}

/// Emitted to every window when the registry changes, with the window that changed it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginEvent {
    pub origin: String,
}

impl AppState {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        // Overrides for portable setups and tests: where the app keeps its lists and settings,
        // and where new workspaces go.
        let env_dir = |name: &str| {
            std::env::var_os(name)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        let config_dir = match env_dir("TESSERA_CONFIG_DIR") {
            Some(dir) => dir,
            None => app.path().app_config_dir()?,
        };
        std::fs::create_dir_all(&config_dir)?;
        let default_root = env_dir("TESSERA_WORKSPACES_DIR")
            .or_else(|| app.path().home_dir().ok().map(|home| home.join("Tessera")));
        let paths = Paths {
            registry: config_dir.join("workspaces.json"),
            prefs: config_dir.join("preferences.json"),
            servers: config_dir.join("servers.json"),
            default_root,
        };
        let registry = Registry::load(paths.registry.clone(), paths.default_root.as_deref())?;
        let prefs = Prefs::load(&paths.prefs)?;
        Ok(AppState {
            workspaces: Workspaces::default(),
            registry: Mutex::new(registry),
            prefs: Mutex::new(prefs),
            paths,
            pending_links: Mutex::new(Vec::new()),
            shortcut_error: Mutex::new(None),
            servers_lock: Mutex::new(()),
            exit: ExitState::default(),
        })
    }

    /// Called when a workspace's database is created: the registry remembers that the folder
    /// existed, so it can later tell "never used" from "moved or deleted".
    pub fn workspace_created<R: Runtime>(&self, app: &AppHandle<R>, id: &str) {
        let result = self
            .registry
            .lock()
            .map_err(poisoned)
            .and_then(|mut r| r.mark_initialized(id));
        match result {
            Ok(()) => {
                let _ = app.emit(
                    "desktop://registry-changed",
                    OriginEvent {
                        origin: String::new(),
                    },
                );
            }
            Err(error) => log::warn!("could not record the creation of workspace {id}: {error}"),
        }
    }
}
