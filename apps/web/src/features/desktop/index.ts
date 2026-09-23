import { defineFeature } from '@tessera/core';

/**
 * Desktop (Agent 07). Registers the Tauri DocStore, AssetStore and WorkspaceRegistry (priority 100, available only inside Tauri); logic lives in `@tessera/desktop`. In a browser this feature does nothing.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const desktopFeature = defineFeature({ id: 'desktop' });
