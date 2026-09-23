//! The main window, the quick-capture window, the tray icon and the global shortcut.

use crate::error::{poisoned, Error, Result};
use crate::menu;
use crate::state::{AppState, CAPTURE_WINDOW, MAIN_WINDOW};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const TRAY_ID: &str = "main";

/// Shows, unminimizes and focuses the main window.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens the quick-capture window: a small always-on-top window with the `/capture` route. It's
/// created on first use and hidden (not destroyed) afterwards, so later opens are instant.
pub fn show_capture<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let has_workspace = {
        let state = app.state::<AppState>();
        let registry = state.registry.lock().map_err(poisoned)?;
        !registry.items().is_empty()
    };
    if !has_workspace {
        // Nothing to capture into yet: the main window shows onboarding.
        show_main(app);
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW) {
        window.center()?;
        window.show()?;
        window.set_focus()?;
        app.emit_to(CAPTURE_WINDOW, "desktop://capture-shown", ())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, CAPTURE_WINDOW, WebviewUrl::App("capture".into()))
        .title("Quick capture")
        .inner_size(600.0, 300.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .focused(true)
        .shadow(true)
        .disable_drag_drop_handler()
        .build()?;
    // The page calls `capture_ready` once rendered; show it anyway if that never comes.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        if let Some(window) = app.get_webview_window(CAPTURE_WINDOW) {
            if !window.is_visible().unwrap_or(true) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
    Ok(())
}

pub fn capture_ready<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let window = app
        .get_webview_window(CAPTURE_WINDOW)
        .ok_or_else(|| Error::NotFound("no capture window".into()))?;
    window.center()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn hide_capture<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW) {
        window.hide()?;
    }
    Ok(())
}

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let menu = menu::default_tray(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Tessera")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(desktop)]
pub fn apply_shortcut<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let state = app.state::<AppState>();
    let prefs = state.prefs.lock().map_err(poisoned)?.clone();
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let mut error = None;
    if prefs.capture_enabled {
        match prefs.capture_shortcut.parse::<Shortcut>() {
            Ok(shortcut) => {
                if let Err(e) = shortcuts.register(shortcut) {
                    error = Some(format!("{} is not available: {e}", prefs.capture_shortcut));
                }
            }
            Err(e) => {
                error = Some(format!(
                    "{} is not a valid shortcut: {e}",
                    prefs.capture_shortcut
                ))
            }
        }
    }
    if let Some(message) = &error {
        log::warn!("quick capture shortcut: {message}");
    }
    *state.shortcut_error.lock().map_err(poisoned)? = error;
    Ok(())
}

#[cfg(not(desktop))]
pub fn apply_shortcut<R: Runtime>(_app: &AppHandle<R>) -> Result<()> {
    Ok(())
}
