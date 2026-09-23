import { defineFeature } from '@tessera/core';
import { isTauri } from '@tessera/desktop';

/**
 * Desktop (Agent 07). Inside the Tauri app this loads `@tessera/desktop/feature`: folder-based
 * storage (SQLite + files, priority 100), the workspace picker, quick capture, native menus, deep
 * links and the Desktop settings panel. In a browser the feature is empty and loads nothing.
 */
export const desktopFeature = isTauri()
  ? (await import('@tessera/desktop/feature')).desktopFeature
  : defineFeature({ id: 'desktop' });
