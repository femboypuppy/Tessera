//! Native menus. The web side describes the app menu and the tray menu (translated with `t()`)
//! and sends them with `menu_set`; this module validates the description and builds the menus.
//! Clicks on items with an ID are forwarded to the main window as `desktop://menu` events, except
//! the few handled natively (`app.quit`, `tray.*`).

use crate::error::{Error, Result};
use serde::Deserialize;
use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MenuNode {
    Item {
        id: String,
        label: String,
        #[serde(default)]
        accelerator: Option<String>,
        #[serde(default = "enabled")]
        enabled: bool,
    },
    Separator,
    Predefined {
        item: Predefined,
        #[serde(default)]
        label: Option<String>,
    },
    Submenu {
        label: String,
        #[serde(default)]
        role: Option<SubmenuRole>,
        items: Vec<MenuNode>,
    },
}

fn enabled() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Predefined {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Maximize,
    Fullscreen,
    Hide,
    HideOthers,
    ShowAll,
    CloseWindow,
    Quit,
    About,
    Services,
    BringAllToFront,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmenuRole {
    Window,
    Help,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSpec {
    pub menu: Vec<MenuNode>,
    pub tray: Vec<MenuNode>,
}

const MAX_NODES: usize = 300;
const MAX_DEPTH: usize = 4;

/// Checks IDs, labels, sizes and nesting before anything is built.
pub fn validate(spec: &MenuSpec) -> Result<()> {
    fn walk(nodes: &[MenuNode], depth: usize, count: &mut usize) -> Result<()> {
        if depth > MAX_DEPTH {
            return Err(Error::Invalid("menus are nested too deeply".into()));
        }
        for node in nodes {
            *count += 1;
            if *count > MAX_NODES {
                return Err(Error::Invalid("the menu has too many items".into()));
            }
            match node {
                MenuNode::Item {
                    id,
                    label,
                    accelerator,
                    ..
                } => {
                    let valid_id = !id.is_empty()
                        && id.len() <= 64
                        && id
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
                    if !valid_id {
                        return Err(Error::Invalid(format!("invalid menu item ID {id:?}")));
                    }
                    check_label(label)?;
                    if let Some(accelerator) = accelerator {
                        if accelerator.len() > 64 {
                            return Err(Error::Invalid("accelerator too long".into()));
                        }
                    }
                }
                MenuNode::Predefined {
                    label: Some(label), ..
                } => check_label(label)?,
                MenuNode::Submenu { label, items, .. } => {
                    check_label(label)?;
                    walk(items, depth + 1, count)?;
                }
                _ => {}
            }
        }
        Ok(())
    }
    let mut count = 0;
    walk(&spec.menu, 1, &mut count)?;
    walk(&spec.tray, 1, &mut count)
}

fn check_label(label: &str) -> Result<()> {
    if label.trim().is_empty() || label.chars().count() > 100 {
        return Err(Error::Invalid(format!("invalid menu label {label:?}")));
    }
    Ok(())
}

type Items<R> = Vec<Box<dyn IsMenuItem<R>>>;

fn build_items<R: Runtime>(app: &AppHandle<R>, nodes: &[MenuNode]) -> Result<Items<R>> {
    let mut items: Items<R> = Vec::with_capacity(nodes.len());
    for node in nodes {
        match node {
            MenuNode::Item {
                id,
                label,
                accelerator,
                enabled,
            } => {
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id.as_str(),
                    label,
                    *enabled,
                    accelerator.as_deref(),
                )?));
            }
            MenuNode::Separator => items.push(Box::new(PredefinedMenuItem::separator(app)?)),
            MenuNode::Predefined { item, label } => {
                let label = label.as_deref();
                let built = match item {
                    Predefined::Undo => PredefinedMenuItem::undo(app, label)?,
                    Predefined::Redo => PredefinedMenuItem::redo(app, label)?,
                    Predefined::Cut => PredefinedMenuItem::cut(app, label)?,
                    Predefined::Copy => PredefinedMenuItem::copy(app, label)?,
                    Predefined::Paste => PredefinedMenuItem::paste(app, label)?,
                    Predefined::SelectAll => PredefinedMenuItem::select_all(app, label)?,
                    Predefined::Minimize => PredefinedMenuItem::minimize(app, label)?,
                    Predefined::Maximize => PredefinedMenuItem::maximize(app, label)?,
                    Predefined::Fullscreen => PredefinedMenuItem::fullscreen(app, label)?,
                    Predefined::Hide => PredefinedMenuItem::hide(app, label)?,
                    Predefined::HideOthers => PredefinedMenuItem::hide_others(app, label)?,
                    Predefined::ShowAll => PredefinedMenuItem::show_all(app, label)?,
                    Predefined::CloseWindow => PredefinedMenuItem::close_window(app, label)?,
                    Predefined::Quit => PredefinedMenuItem::quit(app, label)?,
                    Predefined::Services => PredefinedMenuItem::services(app, label)?,
                    Predefined::BringAllToFront => {
                        PredefinedMenuItem::bring_all_to_front(app, label)?
                    }
                    Predefined::About => {
                        let info = app.package_info();
                        let metadata = AboutMetadata {
                            name: Some(info.name.clone()),
                            version: Some(info.version.to_string()),
                            website: Some("https://github.com/femboypuppy/Tessera-Notes".into()),
                            license: Some("MIT".into()),
                            icon: app.default_window_icon().cloned(),
                            ..Default::default()
                        };
                        PredefinedMenuItem::about(app, label, Some(metadata))?
                    }
                };
                items.push(Box::new(built));
            }
            MenuNode::Submenu {
                label,
                role,
                items: children,
            } => {
                let children = build_items(app, children)?;
                let refs: Vec<&dyn IsMenuItem<R>> =
                    children.iter().map(|item| item.as_ref()).collect();
                let submenu = Submenu::with_items(app, label, true, &refs)?;
                #[cfg(target_os = "macos")]
                match role {
                    Some(SubmenuRole::Window) => submenu.set_as_windows_menu_for_nsapp()?,
                    Some(SubmenuRole::Help) => submenu.set_as_help_menu_for_nsapp()?,
                    None => {}
                }
                #[cfg(not(target_os = "macos"))]
                let _ = role;
                items.push(Box::new(submenu));
            }
        }
    }
    Ok(items)
}

/// Builds a menu from nodes (the app menu's top level must be submenus).
pub fn build<R: Runtime>(app: &AppHandle<R>, nodes: &[MenuNode]) -> Result<Menu<R>> {
    let items = build_items(app, nodes)?;
    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|item| item.as_ref()).collect();
    Ok(Menu::with_items(app, &refs)?)
}

/// The tray menu used until the web side sends a translated one.
pub fn default_tray<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>> {
    let nodes = vec![
        MenuNode::Item {
            id: "tray.show".into(),
            label: "Open Tessera".into(),
            accelerator: None,
            enabled: true,
        },
        MenuNode::Item {
            id: "tray.capture".into(),
            label: "Quick capture".into(),
            accelerator: None,
            enabled: true,
        },
        MenuNode::Separator,
        MenuNode::Item {
            id: "app.quit".into(),
            label: "Quit Tessera".into(),
            accelerator: None,
            enabled: true,
        },
    ];
    build(app, &nodes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(json: serde_json::Value) -> MenuSpec {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn parses_and_validates_a_menu() {
        let menu = spec(serde_json::json!({
            "menu": [{ "type": "submenu", "label": "File", "items": [
                { "type": "item", "id": "shell.newPage", "label": "New page", "accelerator": "CmdOrCtrl+N" },
                { "type": "separator" },
                { "type": "predefined", "item": "quit", "label": "Quit Tessera" }
            ]}, { "type": "submenu", "label": "Window", "role": "window", "items": [
                { "type": "predefined", "item": "minimize" }
            ]}],
            "tray": [{ "type": "item", "id": "tray.show", "label": "Open Tessera" }]
        }));
        assert!(validate(&menu).is_ok());
    }

    #[test]
    fn rejects_bad_ids_labels_and_depth() {
        let bad_id = spec(
            serde_json::json!({ "menu": [{ "type": "item", "id": "a b", "label": "x" }], "tray": [] }),
        );
        assert!(validate(&bad_id).is_err());
        let empty_label = spec(
            serde_json::json!({ "menu": [{ "type": "item", "id": "a", "label": " " }], "tray": [] }),
        );
        assert!(validate(&empty_label).is_err());
        let mut nested = serde_json::json!({ "type": "item", "id": "leaf", "label": "Leaf" });
        for _ in 0..6 {
            nested = serde_json::json!({ "type": "submenu", "label": "Sub", "items": [nested] });
        }
        let deep = spec(serde_json::json!({ "menu": [nested], "tray": [] }));
        assert!(validate(&deep).is_err());
        let many: Vec<_> = (0..400)
            .map(|i| serde_json::json!({ "type": "item", "id": format!("i{i}"), "label": "x" }))
            .collect();
        assert!(validate(&spec(serde_json::json!({ "menu": many, "tray": [] }))).is_err());
    }
}
