import type { ServerApi } from '../client/api';
import type { RemoteAssets } from '../stores/asset-store';
import { signalOutbox, syncStateFor } from './shared';

/**
 * Assets of a workspace that syncs: new ones are queued in the outbox (uploaded by the background
 * sync, also after a reload), missing ones are downloaded from the server on first use.
 */
export function createRemoteAssets(workspaceId: string, api: ServerApi): RemoteAssets {
  return {
    enqueueUpload(info) {
      void syncStateFor(workspaceId)
        .then((store) => store.enqueue({ kind: 'uploadAsset', assetId: info.assetId }))
        .then(() => signalOutbox(workspaceId))
        .catch((error: unknown) => console.error('[sync] could not queue an asset upload', error));
    },
    download: (assetId) => api.downloadAsset(workspaceId, assetId),
  };
}
