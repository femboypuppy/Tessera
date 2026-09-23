import { asBytes, defaultIndexedDb, requestToPromise, transactionDone } from '../idb/idb';
import {
  DOC_INDEX,
  openWorkspaceDatabase,
  STORES,
  workspaceDatabaseName,
  type IndexedDbOptions,
} from '../idb/schema';

export type VersionKind = 'auto' | 'manual' | 'restore';

/** A version's metadata (what the history list shows). */
export interface VersionMeta {
  id: string;
  docName: string;
  createdAt: number;
  createdBy: string | null;
  authorName: string | null;
  label: string | null;
  kind: VersionKind;
  size: number;
}

/** A version stored on this device: metadata plus the page doc's Yjs state. */
export interface VersionRecord extends VersionMeta {
  state: Uint8Array;
  /** The server has it (or it never needs to: local-only workspaces). */
  uploaded: boolean;
}

/** Automatic versions kept per page on this device (saved ones are always kept). */
export const MAX_LOCAL_AUTO_VERSIONS = 50;

function toRecord(value: unknown): VersionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<VersionRecord>;
  const state = asBytes(record.state);
  if (typeof record.id !== 'string' || typeof record.docName !== 'string' || !state) return null;
  if (record.kind !== 'auto' && record.kind !== 'manual' && record.kind !== 'restore') return null;
  return {
    id: record.id,
    docName: record.docName,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    createdBy: typeof record.createdBy === 'string' ? record.createdBy : null,
    authorName: typeof record.authorName === 'string' ? record.authorName : null,
    label: typeof record.label === 'string' ? record.label : null,
    kind: record.kind,
    size: state.byteLength,
    state,
    uploaded: record.uploaded === true,
  };
}

function metaOf(record: VersionRecord): VersionMeta {
  const { state: _state, uploaded: _uploaded, ...meta } = record;
  return meta;
}

/** Version snapshots on this device, in the workspace database. */
export class LocalVersionStore {
  static async open(
    workspaceId: string,
    options: IndexedDbOptions = {},
  ): Promise<LocalVersionStore> {
    const factory = options.indexedDB ?? defaultIndexedDb();
    if (!factory) throw new Error('IndexedDB is not available');
    const store = new LocalVersionStore();
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

  async add(record: VersionRecord): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.versions, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORES.versions);
    store.put(record);
    if (record.kind === 'auto') {
      // Keep the newest automatic versions of this page.
      const request = store.index(DOC_INDEX).getAll(IDBKeyRange.only(record.docName));
      request.onsuccess = () => {
        const autos = request.result
          .map(toRecord)
          .filter((item): item is VersionRecord => item?.kind === 'auto')
          .sort((a, b) => b.createdAt - a.createdAt);
        for (const old of autos.slice(MAX_LOCAL_AUTO_VERSIONS)) store.delete(old.id);
      };
    }
    await done;
  }

  async get(id: string): Promise<VersionRecord | null> {
    const db = this.requireDb();
    const value: unknown = await requestToPromise(
      db.transaction(STORES.versions, 'readonly').objectStore(STORES.versions).get(id),
    );
    return toRecord(value);
  }

  /** A page's versions, newest first (metadata only). */
  async list(docName: string): Promise<VersionMeta[]> {
    return (await this.records(docName)).map(metaOf);
  }

  /** The newest version of a page, with its state. */
  async latest(docName: string): Promise<VersionRecord | null> {
    return (await this.records(docName))[0] ?? null;
  }

  async markUploaded(id: string): Promise<void> {
    const record = await this.get(id);
    if (!record || record.uploaded) return;
    const db = this.requireDb();
    const transaction = db.transaction(STORES.versions, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORES.versions).put({ ...record, uploaded: true });
    await done;
  }

  /** Deletes a page's history (when the page is deleted permanently). */
  async deleteForDoc(docName: string): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.versions, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    const request = transaction
      .objectStore(STORES.versions)
      .index(DOC_INDEX)
      .openKeyCursor(IDBKeyRange.only(docName));
    const store = transaction.objectStore(STORES.versions);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await done;
  }

  dispose(): void {
    this.db?.close();
    this.db = null;
  }

  private async records(docName: string): Promise<VersionRecord[]> {
    const db = this.requireDb();
    const values = await requestToPromise(
      db
        .transaction(STORES.versions, 'readonly')
        .objectStore(STORES.versions)
        .index(DOC_INDEX)
        .getAll(IDBKeyRange.only(docName)),
    );
    return values
      .map(toRecord)
      .filter((record): record is VersionRecord => record !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error('The version store is closed');
    return this.db;
  }
}
