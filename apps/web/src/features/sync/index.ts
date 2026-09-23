import { defineFeature } from '@tessera/core';

/**
 * Storage & sync (Agent 03). Registers the IndexedDB DocStore, AssetStore and WorkspaceRegistry (priority 50), the Hocuspocus SyncProvider, the sync status top bar item, presence avatars, the history panel and the "Sync & account" settings; logic lives in `@tessera/sync`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const syncFeature = defineFeature({ id: 'sync' });
