import { openDatabase } from './idb';

/**
 * One IndexedDB database per workspace holds everything that workspace keeps on this device.
 * Every store is created in version 1, so the doc store, the asset store, version history and the
 * sync bookkeeping can open the same database in any order.
 */
export const WORKSPACE_DB_VERSION = 1;

/** Name of a workspace's database. */
export function workspaceDatabaseName(workspaceId: string): string {
  return `tessera-ws-${workspaceId}`;
}

/** Object stores in a workspace database. */
export const STORES = {
  /** Append-only Yjs update log: `{ doc, update }`, autoIncrement keys, index `doc`. */
  updates: 'updates',
  /** Assets by content hash: `{ assetId, name, mimeType, size, createdAt, data }`. */
  assets: 'assets',
  /** Version snapshots: `VersionRecord`, index `doc`. */
  versions: 'versions',
  /** Per-doc sync bookkeeping: `{ docName, dirty, serverSeq, updatedAt }`. */
  syncState: 'syncState',
  /** Work to send to the server once connected: doc deletions, asset and version uploads. */
  outbox: 'outbox',
} as const;

/** Name of the index on the doc name (`updates` and `versions`). */
export const DOC_INDEX = 'doc';

/** Creates the stores of a workspace database. */
export function upgradeWorkspaceDatabase(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const updates = db.createObjectStore(STORES.updates, { autoIncrement: true });
    updates.createIndex(DOC_INDEX, 'doc', { unique: false });
    db.createObjectStore(STORES.assets, { keyPath: 'assetId' });
    const versions = db.createObjectStore(STORES.versions, { keyPath: 'id' });
    versions.createIndex(DOC_INDEX, 'docName', { unique: false });
    db.createObjectStore(STORES.syncState, { keyPath: 'docName' });
    db.createObjectStore(STORES.outbox, { autoIncrement: true });
  }
}

/** Opens a workspace's database. */
export function openWorkspaceDatabase(
  factory: IDBFactory,
  workspaceId: string,
  onVersionChange?: () => void,
  name: string = workspaceDatabaseName(workspaceId),
): Promise<IDBDatabase> {
  return openDatabase({
    factory,
    name,
    version: WORKSPACE_DB_VERSION,
    upgrade: (db, oldVersion) => upgradeWorkspaceDatabase(db, oldVersion),
    ...(onVersionChange ? { onVersionChange } : {}),
  });
}

/** Options every IndexedDB-backed class accepts (tests inject a fresh fake factory). */
export interface IndexedDbOptions {
  /** Defaults to the global `indexedDB`. */
  indexedDB?: IDBFactory;
  /** Overrides the database name (tests). */
  databaseName?: string;
}
