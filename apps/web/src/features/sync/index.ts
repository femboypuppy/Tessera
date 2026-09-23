import { defineFeature } from '@tessera/core';
import { syncServices } from '@tessera/sync';

/**
 * Storage & sync (Agent 03): the IndexedDB DocStore, AssetStore and WorkspaceRegistry
 * (priority 50). Registration only; everything else lives in `@tessera/sync` behind dynamic
 * imports. See HANDOFF/sync.md.
 */
export const syncFeature = defineFeature({
  id: 'sync',
  services: syncServices,
  async activate(ctx) {
    const { activateSync } = await import('@tessera/sync/activate');
    return activateSync(ctx);
  },
});
