import { defineService, SERVICE_PRIORITY, type AnyServiceRegistration } from '@tessera/core';

/**
 * The sync feature's service registrations. Everything heavy loads through dynamic `import()`,
 * so this module (imported by `apps/web/src/features/sync`) stays tiny.
 */
const stores = () => import('../stores');

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

export const syncServices: AnyServiceRegistration[] = [
  defineService({
    provides: 'workspaceRegistry',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async () => (await stores()).IndexedDbWorkspaceRegistry.open(),
  }),
  defineService({
    provides: 'docStore',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async ({ workspace }) => (await stores()).IndexedDbDocStore.open(workspace.id),
  }),
  defineService({
    provides: 'assetStore',
    id: 'indexeddb',
    priority: SERVICE_PRIORITY.browser,
    isAvailable: hasIndexedDb,
    create: async ({ workspace }) => (await stores()).IndexedDbAssetStore.open(workspace.id),
  }),
];
