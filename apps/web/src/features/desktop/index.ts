import { createDesktopFeature } from '@tessera/desktop';

/**
 * Desktop (Agent 07). Inside the Tauri app: folder-based storage (SQLite + files, priority 100),
 * the workspace picker, quick capture, native menus, deep links and Settings → Desktop, all loaded
 * on demand (`@tessera/desktop`). In a browser the feature is empty and loads nothing.
 */
export const desktopFeature = createDesktopFeature();
