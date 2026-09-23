import type { AppContext } from '@tessera/core';
import { requestPersistentStorage, watchStorageHealth } from './storage-health';

/**
 * Everything the sync feature does per workspace session, loaded lazily from the feature's
 * `activate`. Returns the cleanup the runtime runs when the session closes.
 */
export function activateSync(ctx: AppContext): () => void {
  const cleanups: Array<() => void> = [];
  cleanups.push(watchStorageHealth(ctx));
  if (ctx.serviceSources.docStore === 'indexeddb') void requestPersistentStorage();
  return () => {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error('[sync] cleanup failed', error);
      }
    }
  };
}
