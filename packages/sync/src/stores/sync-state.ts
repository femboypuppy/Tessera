import { defaultIndexedDb, requestToPromise, transactionDone } from '../idb/idb';
import {
  openWorkspaceDatabase,
  STORES,
  workspaceDatabaseName,
  type IndexedDbOptions,
} from '../idb/schema';

/**
 * What this device knows about a doc's sync state:
 * - `dirty`: it may hold changes the server hasn't acknowledged (set with every stored update);
 * - `version`: bumped with every change, so "synced" is only recorded if nothing changed since
 *   the sync started (compare-and-set);
 * - `serverSeq`: the server's sequence number this device last caught up with.
 */
export interface SyncStateRecord {
  docName: string;
  dirty: boolean;
  version: number;
  serverSeq: number | null;
  updatedAt: number;
}

/** Work that must reach the server once connected, kept across reloads. */
export type OutboxItem =
  | { kind: 'deleteDoc'; docName: string }
  | { kind: 'uploadAsset'; assetId: string }
  | { kind: 'uploadVersion'; versionId: string };

function isRecord(value: unknown): value is SyncStateRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SyncStateRecord>;
  return typeof record.docName === 'string' && typeof record.dirty === 'boolean';
}

function isOutboxItem(value: unknown): value is OutboxItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as { kind?: unknown };
  return item.kind === 'deleteDoc' || item.kind === 'uploadAsset' || item.kind === 'uploadVersion';
}

/**
 * Marks docs dirty inside an existing readwrite transaction that includes the `syncState` store
 * (the IndexedDB doc store does it in the same transaction as the update, so a crash can never
 * leave a stored change unmarked).
 */
export function markDirtyInTransaction(
  transaction: IDBTransaction,
  docNames: Iterable<string>,
  now: number,
): void {
  const store = transaction.objectStore(STORES.syncState);
  for (const docName of new Set(docNames)) {
    const request = store.get(docName);
    request.onsuccess = () => {
      const current: unknown = request.result;
      const previous = isRecord(current) ? current : null;
      store.put({
        docName,
        dirty: true,
        version: (previous?.version ?? 0) + 1,
        serverSeq: previous?.serverSeq ?? null,
        updatedAt: now,
      } satisfies SyncStateRecord);
    };
  }
}

/** The `syncState` and `outbox` stores of a workspace database. */
export class SyncStateStore {
  static async open(workspaceId: string, options: IndexedDbOptions = {}): Promise<SyncStateStore> {
    const factory = options.indexedDB ?? defaultIndexedDb();
    if (!factory) throw new Error('IndexedDB is not available');
    const store = new SyncStateStore();
    store.db = await openWorkspaceDatabase(
      factory,
      workspaceId,
      () => {
        store.db = null;
      },
      options.databaseName ?? workspaceDatabaseName(workspaceId),
    );
    return store;
  }

  private db: IDBDatabase | null = null;
  private readonly now: () => number = Date.now;

  /** False once disposed or closed because another tab deleted the workspace. */
  get isOpen(): boolean {
    return this.db !== null;
  }

  async all(): Promise<Map<string, SyncStateRecord>> {
    const db = this.requireDb();
    const records = await requestToPromise(
      db.transaction(STORES.syncState, 'readonly').objectStore(STORES.syncState).getAll(),
    );
    return new Map(records.filter(isRecord).map((record) => [record.docName, record]));
  }

  async get(docName: string): Promise<SyncStateRecord | null> {
    const db = this.requireDb();
    const value: unknown = await requestToPromise(
      db.transaction(STORES.syncState, 'readonly').objectStore(STORES.syncState).get(docName),
    );
    return isRecord(value) ? value : null;
  }

  async markDirty(docNames: Iterable<string>): Promise<void> {
    const names = [...docNames];
    if (names.length === 0) return;
    const db = this.requireDb();
    const transaction = db.transaction(STORES.syncState, 'readwrite');
    const done = transactionDone(transaction);
    markDirtyInTransaction(transaction, names, this.now());
    await done;
  }

  /**
   * Records that a doc is in sync with the server as of `serverSeq`. Clears `dirty` only if the
   * doc didn't change since `observedVersion` was read (otherwise it stays dirty for next time).
   */
  async markSynced(
    docName: string,
    observedVersion: number,
    serverSeq: number | null,
  ): Promise<boolean> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.syncState, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORES.syncState);
    let cleared = false;
    const request = store.get(docName);
    request.onsuccess = () => {
      const current: unknown = request.result;
      const previous = isRecord(current) ? current : null;
      const unchanged = (previous?.version ?? 0) === observedVersion;
      cleared = unchanged;
      store.put({
        docName,
        dirty: unchanged ? false : (previous?.dirty ?? false),
        version: previous?.version ?? 0,
        serverSeq: Math.max(previous?.serverSeq ?? 0, serverSeq ?? 0) || null,
        updatedAt: this.now(),
      } satisfies SyncStateRecord);
    };
    await done;
    return cleared;
  }

  async remove(docName: string): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.syncState, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORES.syncState).delete(docName);
    await done;
  }

  // Outbox.

  async enqueue(item: OutboxItem): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.outbox, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    transaction.objectStore(STORES.outbox).add(item);
    await done;
  }

  async outbox(): Promise<Array<{ key: IDBValidKey; item: OutboxItem }>> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.outbox, 'readonly');
    const store = transaction.objectStore(STORES.outbox);
    const [keys, values] = await Promise.all([
      requestToPromise(store.getAllKeys()),
      requestToPromise(store.getAll()),
    ]);
    const items: Array<{ key: IDBValidKey; item: OutboxItem }> = [];
    keys.forEach((key, index) => {
      const value: unknown = values[index];
      if (isOutboxItem(value)) items.push({ key, item: value });
    });
    return items;
  }

  async removeOutbox(key: IDBValidKey): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.outbox, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORES.outbox).delete(key);
    await done;
  }

  dispose(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error('The sync state store is closed');
    return this.db;
  }
}
