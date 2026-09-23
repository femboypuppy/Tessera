/**
 * `@tessera/sync/stores`: the IndexedDB implementations of the storage services. The sync feature
 * imports this module lazily from its service registrations.
 */
export { IndexedDbDocStore, type IndexedDbDocStoreOptions } from './doc-store';
export {
  IndexedDbAssetStore,
  type IndexedDbAssetStoreOptions,
  type ObjectUrls,
  type RemoteAssets,
} from './asset-store';
export {
  IndexedDbWorkspaceRegistry,
  REGISTRY_DB_NAME,
  type IndexedDbWorkspaceRegistryOptions,
} from './workspace-registry';
export { StoreClosedError, type StorageErrorInfo } from './storage-errors';
export { compactUpdates, mergeUpdatesSafely } from './updates';
export { workspaceDatabaseName } from '../idb/schema';
