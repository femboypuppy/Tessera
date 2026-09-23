import { COMMANDS, commandShortcuts, parseShortcut, type AppContext } from '@tessera/core';
import type { MenuNode, MenuSpec } from '../backend/protocol';
import { DESKTOP_COMMANDS, MENU_ONLY } from '../constants';
import { t } from '../i18n';
import { revealLabel } from '../lib/paths';

export { DESKTOP_COMMANDS, MENU_ONLY } from '../constants';

const KEY_NAMES: Record<string, string> = {
  '\\': 'Backslash',
  '=': 'Equal',
  '-': 'Minus',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '`': 'Backquote',
  Plus: 'Equal',
};

/**
 * Converts a web shortcut (`Mod+Shift+L`) to a Tauri accelerator (`CmdOrCtrl+Shift+L`). Returns
 * null for shortcuts without a modifier (`?`): as a menu accelerator they would swallow typing.
 */
export function toAccelerator(shortcut: string): string | null {
  let parsed;
  try {
    parsed = parseShortcut(shortcut);
  } catch {
    return null;
  }
  const { modifiers, key } = parsed;
  if (!['Mod', 'Ctrl', 'Alt', 'Meta'].some((m) => modifiers.has(m as 'Mod'))) return null;
  const parts: string[] = [];
  if (modifiers.has('Mod')) parts.push('CmdOrCtrl');
  if (modifiers.has('Ctrl')) parts.push('Ctrl');
  if (modifiers.has('Meta')) parts.push('Super');
  if (modifiers.has('Alt')) parts.push('Alt');
  if (modifiers.has('Shift')) parts.push('Shift');
  parts.push(KEY_NAMES[key] ?? key);
  return parts.join('+');
}

export interface BuiltMenu {
  spec: MenuSpec;
  /** Web shortcut of each menu item with an accelerator (for de-duplication). */
  shortcuts: Map<string, string>;
}

/** Builds the native menus from the commands that exist right now, translated. */
export function buildAppMenu(ctx: AppContext, options: { isMac: boolean }): BuiltMenu {
  const { isMac } = options;
  const shortcuts = new Map<string, string>();
  const item = (id: string, label: string, shortcut?: string | null): MenuNode | null => {
    const command = ctx.commands.get(id);
    const isMenuOnly = id === MENU_ONLY.undo || id === MENU_ONLY.redo;
    if (!command && !isMenuOnly) return null;
    const web = shortcut === undefined ? commandShortcuts(command ?? {})[0] : shortcut;
    const accelerator = web ? toAccelerator(web) : null;
    if (web && accelerator) shortcuts.set(id, web);
    return { type: 'item', id, label, accelerator };
  };
  const compact = (nodes: Array<MenuNode | null>): MenuNode[] => {
    const present = nodes.filter((node): node is MenuNode => node !== null);
    // No leading, trailing or doubled separators after missing commands are dropped.
    return present.filter(
      (node, index) =>
        node.type !== 'separator' ||
        (index > 0 && index < present.length - 1 && present[index - 1]?.type !== 'separator'),
    );
  };
  const separator: MenuNode = { type: 'separator' };

  const appMenu: MenuNode = {
    type: 'submenu',
    label: 'Tessera',
    items: compact([
      { type: 'predefined', item: 'about', label: t('about') },
      separator,
      item(DESKTOP_COMMANDS.checkForUpdates, t('checkForUpdates')),
      item(COMMANDS.openSettings, t('settings')),
      separator,
      { type: 'predefined', item: 'services', label: t('services') },
      separator,
      { type: 'predefined', item: 'hide', label: t('hide') },
      { type: 'predefined', item: 'hideOthers', label: t('hideOthers') },
      { type: 'predefined', item: 'showAll', label: t('showAll') },
      separator,
      { type: 'item', id: 'app.quit', label: t('quit'), accelerator: 'CmdOrCtrl+Q' },
    ]),
  };
  const file: MenuNode = {
    type: 'submenu',
    label: t('menuFile'),
    items: compact([
      item(COMMANDS.newPage, t('newPage'), 'Mod+N'),
      separator,
      item(DESKTOP_COMMANDS.newWorkspace, t('newWorkspace')),
      item(DESKTOP_COMMANDS.openWorkspaces, t('openWorkspace')),
      item(DESKTOP_COMMANDS.openFolder, t('openFolder')),
      item(DESKTOP_COMMANDS.revealWorkspace, revealLabel(isMac ? 'mac' : ctx.platform.os)),
      separator,
      { type: 'item', id: 'app.capture', label: t('quickCapture') },
      ...(isMac
        ? [separator, { type: 'predefined', item: 'closeWindow', label: t('closeWindow') } as const]
        : [
            separator,
            item(COMMANDS.openSettings, t('settings')),
            separator,
            { type: 'item', id: 'app.quit', label: t('quit'), accelerator: 'CmdOrCtrl+Q' } as const,
          ]),
    ]),
  };
  const edit: MenuNode = {
    type: 'submenu',
    label: t('menuEdit'),
    items: compact([
      item(MENU_ONLY.undo, t('undo'), 'Mod+Z'),
      item(MENU_ONLY.redo, t('redo'), 'Mod+Shift+Z'),
      separator,
      { type: 'predefined', item: 'cut', label: t('cut') },
      { type: 'predefined', item: 'copy', label: t('copy') },
      { type: 'predefined', item: 'paste', label: t('paste') },
      { type: 'predefined', item: 'selectAll', label: t('selectAll') },
      separator,
      item(DESKTOP_COMMANDS.copyDeepLink, t('copyDeepLink')),
    ]),
  };
  const view: MenuNode = {
    type: 'submenu',
    label: t('menuView'),
    items: compact([
      item(COMMANDS.openPalette, t('search')),
      separator,
      item(COMMANDS.toggleSidebar, t('toggleSidebar')),
      item(COMMANDS.toggleTheme, t('toggleTheme')),
      separator,
      item(DESKTOP_COMMANDS.zoomIn, t('zoomIn')),
      item(DESKTOP_COMMANDS.zoomOut, t('zoomOut')),
      item(DESKTOP_COMMANDS.resetZoom, t('actualSize')),
      separator,
      item(DESKTOP_COMMANDS.toggleFullscreen, t('toggleFullScreen')),
    ]),
  };
  const windowMenu: MenuNode = {
    type: 'submenu',
    label: t('menuWindow'),
    role: 'window',
    items: compact([
      { type: 'predefined', item: 'minimize', label: t('minimize') },
      { type: 'predefined', item: 'maximize', label: t('zoomWindow') },
      ...(isMac
        ? [
            separator,
            { type: 'predefined', item: 'bringAllToFront', label: t('bringAllToFront') } as const,
          ]
        : []),
    ]),
  };
  const help: MenuNode = {
    type: 'submenu',
    label: t('menuHelp'),
    role: 'help',
    items: compact([
      item(COMMANDS.showShortcuts, t('keyboardShortcuts'), 'Mod+/'),
      separator,
      item(DESKTOP_COMMANDS.openDocs, t('documentation')),
      item(DESKTOP_COMMANDS.openReleases, t('releaseNotes')),
      item(DESKTOP_COMMANDS.reportIssue, t('reportIssue')),
      ...(isMac
        ? []
        : [
            separator,
            item(DESKTOP_COMMANDS.checkForUpdates, t('checkForUpdates')),
            { type: 'predefined', item: 'about', label: t('about') } as const,
          ]),
    ]),
  };
  const tray = compact([
    { type: 'item', id: 'tray.show', label: t('openTessera') },
    { type: 'item', id: 'tray.capture', label: t('quickCapture') },
    ctx.commands.has(COMMANDS.newPage)
      ? { type: 'item', id: 'tray.newPage', label: t('newPage') }
      : null,
    separator,
    { type: 'item', id: 'app.quit', label: t('quit') },
  ]);
  return {
    spec: { menu: [...(isMac ? [appMenu] : []), file, edit, view, windowMenu, help], tray },
    shortcuts,
  };
}
