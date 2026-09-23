//! Shutting down without losing a keystroke. Before the process exits (Quit, closing the last
//! window, installing an update) every window is asked to flush its pending writes
//! (`desktop://flush-request`, answered with the `flush_done` command), then every database is
//! checkpointed and closed. A window that doesn't answer within the timeout (a hung page) doesn't
//! block quitting.

use crate::state::AppState;
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const FLUSH_TIMEOUT: Duration = Duration::from_millis(3000);

/// Flushes every window and closes every workspace, then runs `then` (exit, restart, install).
/// Runs on its own thread; a second call while one is running does nothing.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>, then: impl FnOnce(&AppHandle<R>) + Send + 'static) {
    let state = app.state::<AppState>();
    if state.exit.in_progress.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut pending: HashSet<String> = app.webview_windows().keys().cloned().collect();
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut acks) = state.exit.acks.lock() {
            *acks = Some(sender);
        }
        if let Err(error) = app.emit("desktop://flush-request", ()) {
            log::warn!("could not ask windows to flush: {error}");
            pending.clear();
        }
        let deadline = Instant::now() + FLUSH_TIMEOUT;
        while !pending.is_empty() {
            let left = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(left) {
                Ok(label) => {
                    pending.remove(&label);
                }
                Err(_) => {
                    log::warn!("windows {pending:?} did not confirm their writes before exiting");
                    break;
                }
            }
        }
        state.workspaces.close_all();
        state.exit.ready.store(true, Ordering::SeqCst);
        then(&app);
    });
}

/// Quits the app safely.
pub fn quit<R: Runtime>(app: &AppHandle<R>, code: i32) {
    shutdown(app, move |app| app.exit(code));
}

/// A window confirmed that its writes are durable.
pub fn flush_done<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let state = app.state::<AppState>();
    if let Ok(acks) = state.exit.acks.lock() {
        if let Some(sender) = acks.as_ref() {
            let _ = sender.send(label.to_string());
        }
    };
}
