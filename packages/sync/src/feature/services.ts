import { defineService, SERVICE_PRIORITY, type AnyServiceRegistration } from '@tessera/core';

/**
 * The sync feature's service registrations. Everything heavy loads through dynamic `import()`,
 * so this module (imported by `apps/web/src/features/sync`) stays tiny.
 */
const stores = () => import('../stores');
const provider = () => import('../provider');
const client = () => import('../client/connection');

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

export const syncServices: AnyServiceRegistration[] = [
  defineService({
    provides: 'workspaceRegistry',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async () => {
      // Runs once at startup, before the shell navigates: keep an invite link's token.
      (await import('./invite-link')).rememberInviteFromUrl();
      return (await stores()).IndexedDbWorkspaceRegistry.open();
    },
  }),
  defineService({
    // Bearer tokens for the desktop app when its keychain store (priority 100) isn't available.
    provides: 'credentialStore',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async () => new (await import('../client/connection')).IndexedDbCredentialStore(),
  }),
  defineService({
    provides: 'docStore',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async ({ workspace }) =>
      (await stores()).IndexedDbDocStore.open(workspace.id, {
        trackSync: Boolean(workspace.serverUrl),
      }),
  }),
  defineService({
    provides: 'assetStore',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async ({ workspace, platform, app }) => {
      if (workspace.serverUrl) (await client()).setCredentialStore(app.credentialStore);
      const remote = workspace.serverUrl
        ? (await provider()).remoteAssetsFor(workspace, platform)
        : null;
      return (await stores()).IndexedDbAssetStore.open(workspace.id, { remote });
    },
  }),
  defineService({
    provides: 'syncProvider',
    id: 'hocuspocus',
    priority: SERVICE_PRIORITY.browser,
    // A workspace works locally until it is connected to a server.
    isAvailable: ({ workspace }) =>
      Boolean(workspace.serverUrl) && typeof WebSocket !== 'undefined',
    create: async ({ workspace, platform, app }) => {
      (await client()).setCredentialStore(app.credentialStore);
      return (await provider()).createHocuspocusProvider(workspace, platform);
    },
  }),
];
