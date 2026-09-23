import { ASSET_ID_PATTERN, newId, sha256Hex, type AssetInfo, type AssetStore } from '@tessera/core';
import { defaultIndexedDb, requestToPromise, transactionDone } from '../idb/idb';
import {
  openWorkspaceDatabase,
  STORES,
  workspaceDatabaseName,
  type IndexedDbOptions,
} from '../idb/schema';
import { StorageErrorEmitter, StoreClosedError, type StorageErrorInfo } from './storage-errors';

/** A stored asset: its metadata and bytes (ArrayBuffer, which every browser stores reliably). */
interface AssetRecord extends AssetInfo {
  data: ArrayBuffer;
}

/**
 * Where assets live when the workspace syncs with a server. The client uploads new assets in the
 * background and downloads missing ones on demand (`@tessera/sync/provider` implements it).
 */
export interface RemoteAssets {
  /** Queues an upload of an asset stored locally (retried until the server has it). */
  enqueueUpload(info: AssetInfo): void;
  /** Downloads an asset this device doesn't have, or null when the server doesn't either. */
  download(assetId: string): Promise<{ blob: Blob; info: AssetInfo } | null>;
}

export interface IndexedDbAssetStoreOptions extends IndexedDbOptions {
  remote?: RemoteAssets | null;
  /** `URL.createObjectURL` and `revokeObjectURL` (tests count calls). */
  urls?: ObjectUrls;
}

function isAssetRecord(value: unknown): value is AssetRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AssetRecord>;
  return (
    typeof record.assetId === 'string' &&
    typeof record.mimeType === 'string' &&
    typeof record.size === 'number' &&
    // Not `instanceof`: IndexedDB may hand back an ArrayBuffer from another realm.
    Object.prototype.toString.call(record.data) === '[object ArrayBuffer]'
  );
}

function infoOf(record: AssetRecord): AssetInfo {
  return {
    assetId: record.assetId,
    name: typeof record.name === 'string' ? record.name : null,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
  };
}

/** Creates and revokes the URLs handed out by the store. */
export interface ObjectUrls {
  create(blob: Blob, assetId: string): string;
  revoke(url: string): void;
}

/** Object URLs, or `tessera-asset:` placeholders where there are none (Node, jsdom). */
const defaultUrls: ObjectUrls = {
  create: (blob, assetId) => {
    try {
      if (typeof URL.createObjectURL === 'function') return URL.createObjectURL(blob);
    } catch {
      // A Blob from another realm (jsdom in Node): fall through to the placeholder.
    }
    return `tessera-asset:${assetId}`;
  },
  revoke: (url) => {
    if (url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function')
      URL.revokeObjectURL(url);
  },
};

/**
 * {@link AssetStore} on IndexedDB. Assets are content-addressed (SHA-256 hex), so storing the
 * same file twice keeps one copy. Object URLs are created once per asset and revoked when the
 * asset is deleted, when every {@link retainUrl} lease is released (for URLs nobody else asked
 * for), and when the store is disposed at the end of the workspace session.
 *
 * With a {@link RemoteAssets} (the workspace syncs), new assets are uploaded in the background and
 * assets missing on this device are downloaded when first needed, then kept locally.
 */
export class IndexedDbAssetStore implements AssetStore {
  static async open(
    workspaceId: string,
    options: IndexedDbAssetStoreOptions = {},
  ): Promise<IndexedDbAssetStore> {
    const factory = options.indexedDB ?? defaultIndexedDb();
    if (!factory) throw new Error('IndexedDB is not available');
    const store = new IndexedDbAssetStore(options);
    store.db = await openWorkspaceDatabase(
      factory,
      workspaceId,
      () => {
        store.db = null;
        store.closed = true;
      },
      options.databaseName ?? workspaceDatabaseName(workspaceId),
    );
    return store;
  }

  private db: IDBDatabase | null = null;
  private closed = false;
  private remote: RemoteAssets | null;
  private readonly urlApi: ObjectUrls;
  private readonly errors = new StorageErrorEmitter();
  /** Cached object URLs: `pinned` URLs came from `getUrl`/`put` and live for the session. */
  private readonly urls = new Map<string, { url: string; leases: number; pinned: boolean }>();
  private readonly downloads = new Map<string, Promise<AssetRecord | null>>();

  private constructor(options: IndexedDbAssetStoreOptions) {
    this.remote = options.remote ?? null;
    this.urlApi = options.urls ?? defaultUrls;
  }

  /** Connects the store to a server (or disconnects it with null). */
  setRemote(remote: RemoteAssets | null): void {
    this.remote = remote;
  }

  onStorageError(listener: (info: StorageErrorInfo) => void): () => void {
    return this.errors.subscribe(listener);
  }

  async put(
    file: Blob,
    options: { name?: string; mimeType?: string } = {},
  ): Promise<{ assetId: string; url: string }> {
    const assetId = (await sha256Hex(file)) ?? newId();
    let record = await this.read(assetId);
    if (!record) {
      const name =
        options.name ?? (typeof File !== 'undefined' && file instanceof File ? file.name : null);
      record = {
        assetId,
        name,
        mimeType: options.mimeType ?? (file.type || 'application/octet-stream'),
        size: file.size,
        createdAt: Date.now(),
        data: await file.arrayBuffer(),
      };
      const db = this.requireDb();
      const transaction = db.transaction(STORES.assets, 'readwrite', { durability: 'strict' });
      const done = transactionDone(transaction);
      transaction.objectStore(STORES.assets).put(record);
      try {
        await done;
      } catch (error) {
        this.errors.emit('asset', error);
        throw error;
      }
      this.remote?.enqueueUpload(infoOf(record));
    }
    return { assetId, url: this.urlFor(record, true) };
  }

  async get(assetId: string): Promise<Blob | null> {
    const record = await this.readOrDownload(assetId);
    return record ? new Blob([record.data], { type: record.mimeType }) : null;
  }

  async getUrl(assetId: string): Promise<string | null> {
    const cached = this.urls.get(assetId);
    if (cached) {
      cached.pinned = true;
      return cached.url;
    }
    const record = await this.readOrDownload(assetId);
    return record ? this.urlFor(record, true) : null;
  }

  /**
   * An object URL for as long as the caller holds the lease (previews, thumbnails). The URL is
   * revoked when the last lease is released, unless `getUrl` also handed it out.
   */
  async retainUrl(assetId: string): Promise<{ url: string; release(): void } | null> {
    let entry = this.urls.get(assetId);
    if (!entry) {
      const record = await this.readOrDownload(assetId);
      if (!record) return null;
      this.urlFor(record, false);
      entry = this.urls.get(assetId);
      if (!entry) return null;
    }
    entry.leases += 1;
    let released = false;
    const leased = entry;
    return {
      url: leased.url,
      release: () => {
        if (released) return;
        released = true;
        leased.leases -= 1;
        if (leased.leases <= 0 && !leased.pinned && this.urls.get(assetId) === leased)
          this.revoke(assetId);
      },
    };
  }

  async getInfo(assetId: string): Promise<AssetInfo | null> {
    const record = await this.read(assetId);
    return record ? infoOf(record) : null;
  }

  async delete(assetId: string): Promise<void> {
    if (!ASSET_ID_PATTERN.test(assetId)) return;
    const db = this.requireDb();
    const transaction = db.transaction(STORES.assets, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    transaction.objectStore(STORES.assets).delete(assetId);
    await done;
    this.revoke(assetId);
  }

  async list(): Promise<AssetInfo[]> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.assets, 'readonly');
    const records = await requestToPromise(transaction.objectStore(STORES.assets).getAll());
    return records.filter(isAssetRecord).map(infoOf);
  }

  /** Whether the asset is stored on this device (without downloading it). */
  async has(assetId: string): Promise<boolean> {
    return (await this.read(assetId)) !== null;
  }

  dispose(): void {
    for (const assetId of [...this.urls.keys()]) this.revoke(assetId);
    this.errors.clear();
    this.db?.close();
    this.db = null;
    this.closed = true;
  }

  private async read(assetId: string): Promise<AssetRecord | null> {
    if (!ASSET_ID_PATTERN.test(assetId)) return null;
    const db = this.requireDb();
    const transaction = db.transaction(STORES.assets, 'readonly');
    const value: unknown = await requestToPromise(
      transaction.objectStore(STORES.assets).get(assetId),
    );
    return isAssetRecord(value) ? value : null;
  }

  private async readOrDownload(assetId: string): Promise<AssetRecord | null> {
    const local = await this.read(assetId);
    if (local || !this.remote) return local;
    let pending = this.downloads.get(assetId);
    if (!pending) {
      pending = this.download(assetId).finally(() => this.downloads.delete(assetId));
      this.downloads.set(assetId, pending);
    }
    return pending;
  }

  private async download(assetId: string): Promise<AssetRecord | null> {
    const remote = this.remote;
    if (!remote) return null;
    let result: { blob: Blob; info: AssetInfo } | null;
    try {
      result = await remote.download(assetId);
    } catch (error) {
      console.warn(`[sync] could not download asset ${assetId}`, error);
      return null;
    }
    if (!result) return null;
    const record: AssetRecord = { ...result.info, assetId, data: await result.blob.arrayBuffer() };
    try {
      const db = this.requireDb();
      const transaction = db.transaction(STORES.assets, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(STORES.assets).put(record);
      await done;
    } catch (error) {
      // Still usable for this session; it downloads again next time.
      this.errors.emit('asset', error);
    }
    return record;
  }

  private urlFor(record: AssetRecord, pin: boolean): string {
    const existing = this.urls.get(record.assetId);
    if (existing) {
      if (pin) existing.pinned = true;
      return existing.url;
    }
    const url = this.urlApi.create(
      new Blob([record.data], { type: record.mimeType }),
      record.assetId,
    );
    this.urls.set(record.assetId, { url, leases: 0, pinned: pin });
    return url;
  }

  private revoke(assetId: string): void {
    const entry = this.urls.get(assetId);
    if (!entry) return;
    this.urls.delete(assetId);
    try {
      this.urlApi.revoke(entry.url);
    } catch {
      // Revoking an already revoked URL is harmless.
    }
  }

  private requireDb(): IDBDatabase {
    if (this.closed || !this.db) throw new StoreClosedError('The asset store is closed');
    return this.db;
  }
}
