/**
 * `@tessera/sync/provider`: the Hocuspocus sync provider and the background sync, loaded only
 * for workspaces that sync with a server.
 */
import type { PlatformInfo, WorkspaceInfo } from '@tessera/core';
import { authModeFor, credentialStore, serverApi } from '../client/connection';
import { HocuspocusSyncProvider } from './hocuspocus-provider';
import { createRemoteAssets } from './remote-assets';

export { HocuspocusSyncProvider, type HocuspocusSyncProviderOptions } from './hocuspocus-provider';
export { BackgroundReplicator, type ReplicatorOptions, type UploadableVersion } from './replicator';
export { createRemoteAssets } from './remote-assets';
export { serverDocName } from './doc-names';
export { signalOutbox, syncStateFor } from './shared';
export { SyncSocket } from './socket';
export type { TesseraSyncStatus } from './status';

/** Creates the provider of a workspace that has a `serverUrl`. */
export function createHocuspocusProvider(
  workspace: WorkspaceInfo,
  platform: Pick<PlatformInfo, 'isDesktopApp'>,
): HocuspocusSyncProvider {
  const serverUrl = workspace.serverUrl;
  if (!serverUrl) throw new Error('This workspace does not sync with a server');
  const mode = authModeFor(platform);
  return new HocuspocusSyncProvider({
    workspaceId: workspace.id,
    serverUrl,
    mode,
    getToken: () => credentialStore().get(serverUrl),
  });
}

/** The asset store's link to the server (uploads and downloads). */
export function remoteAssetsFor(
  workspace: WorkspaceInfo,
  platform: Pick<PlatformInfo, 'isDesktopApp'>,
) {
  if (!workspace.serverUrl) return null;
  return createRemoteAssets(workspace.id, serverApi(workspace.serverUrl, authModeFor(platform)));
}
