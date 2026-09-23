import type { DocStore } from '@tessera/core';
import { asError } from '../errors';
import { browserChannel, instanceId, type ChannelFactory, type ChannelLike } from '../idb/channel';
import { asBytes, defaultIndexedDb, requestToPromise, transactionDone } from '../idb/idb';
import {
  DOC_INDEX,
  openWorkspaceDatabase,
  STORES,
  workspaceDatabaseName,
  type IndexedDbOptions,
} from '../idb/schema';
import { StorageErrorEmitter, StoreClosedError, type StorageErrorInfo } from './storage-errors';
import { compactUpdates, mergeUpdatesSafely } from './updates';

export interface IndexedDbDocStoreOptions extends IndexedDbOptions {
  /** Multi-tab messaging. Defaults to `BroadcastChannel`; null disables it. */
  channel?: ChannelFactory | null;
  /** Compact a doc in the background once it has this many stored updates. Default 400. */
  compactThreshold?: number;
  /** Delay before a background compaction runs. Default 1500 ms. */
  compactDelayMs?: number;
}

interface UpdateRecord {
  doc: string;
  update: Uint8Array;
}

interface QueuedWrite {
  docName: string;
  update: Uint8Array;
  resolve(): void;
  reject(error: Error): void;
}

/** What one tab tells the others after a write committed. */
interface UpdatesMessage {
  v: 1;
  type: 'updates';
  source: string;
  items: Array<{ doc: string; update: Uint8Array }>;
}

function isUpdatesMessage(value: unknown): value is UpdatesMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<UpdatesMessage>;
  return (
    message.v === 1 &&
    message.type === 'updates' &&
    typeof message.source === 'string' &&
    Array.isArray(message.items)
  );
}

/** Most updates written in one transaction (a burst of remote updates can be large). */
const MAX_BATCH = 250;
/** How long updates from other tabs are kept for a doc that is loading but not watched yet. */
const LOAD_BUFFER_MS = 30_000;

/**
 * {@link DocStore} on IndexedDB: one database per workspace, one append-only update log.
 *
 * - **Durable writes.** `storeUpdate` resolves only after its transaction committed, with strict
 *   durability. Updates arriving together are group-committed in one transaction.
 * - **Compaction without races.** `compact` reads, merges, deletes and rewrites a doc's updates in
 *   one readwrite transaction. IndexedDB serializes readwrite transactions on a store, so a write
 *   from this or another tab lands entirely before (and is merged) or after (and is kept).
 *   Docs are also compacted in the background once they pass `compactThreshold` updates.
 * - **Multi-tab.** After a write commits, the tab broadcasts it; other tabs deliver it through
 *   `watch`, and the runtime applies it without storing it again. Updates that arrive while a
 *   doc is loading are buffered and replayed to its watcher, so none slips between `load` and
 *   `watch`.
 * - **Errors** (a full disk, a database deleted in another tab) reject the write, so the
 *   runtime keeps the update and retries it, and are reported through {@link onStorageError}.
 *
 * @example
 * const store = await IndexedDbDocStore.open(workspace.id);
 * await store.storeUpdate('page:abc', update);
 */
export class IndexedDbDocStore implements DocStore {
  /** Opens the store of a workspace. */
  static async open(
    workspaceId: string,
    options: IndexedDbDocStoreOptions = {},
  ): Promise<IndexedDbDocStore> {
    const factory = options.indexedDB ?? defaultIndexedDb();
    if (!factory) throw new Error('IndexedDB is not available');
    const store = new IndexedDbDocStore(workspaceId, options);
    store.db = await openWorkspaceDatabase(
      factory,
      workspaceId,
      () => store.closeFromOtherTab(),
      options.databaseName ?? workspaceDatabaseName(workspaceId),
    );
    return store;
  }

  readonly workspaceId: string;
  private db: IDBDatabase | null = null;
  private readonly channel: ChannelLike | null;
  private readonly source = instanceId();
  private readonly compactThreshold: number;
  private readonly compactDelayMs: number;
  private readonly errors = new StorageErrorEmitter();

  private queue: QueuedWrite[] = [];
  private writing: Promise<void> | null = null;
  private pumpScheduled = false;

  private readonly watchers = new Map<string, Set<(update: Uint8Array) => void>>();
  private readonly loadBuffers = new Map<
    string,
    { updates: Uint8Array[]; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly counts = new Map<string, number>();
  private readonly compactTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly compactions = new Map<string, Promise<void>>();
  private closedReason: string | null = null;
  private disposed = false;

  private constructor(workspaceId: string, options: IndexedDbDocStoreOptions) {
    this.workspaceId = workspaceId;
    this.compactThreshold = options.compactThreshold ?? 400;
    this.compactDelayMs = options.compactDelayMs ?? 1500;
    const factory = options.channel === undefined ? browserChannel : options.channel;
    this.channel = factory ? factory(`tessera:docs:${workspaceId}`) : null;
    if (this.channel) this.channel.onmessage = (event) => this.receive(event.data);
  }

  /** Reports storage errors (quota, a database deleted in another tab). Returns an unsubscribe. */
  onStorageError(listener: (info: StorageErrorInfo) => void): () => void {
    return this.errors.subscribe(listener);
  }

  /** The current storage problem, or null when the last write succeeded. */
  storageError(): StorageErrorInfo | null {
    return this.errors.current();
  }

  async load(docName: string): Promise<Uint8Array | null> {
    // Updates from other tabs that arrive from now on are kept for this doc's watcher.
    this.beginLoadBuffer(docName);
    try {
      // A readonly transaction must not overtake this tab's own queued writes.
      if (this.queue.some((write) => write.docName === docName)) await this.flushWrites();
      const db = this.requireDb();
      const transaction = db.transaction(STORES.updates, 'readonly');
      const records = await requestToPromise(
        transaction.objectStore(STORES.updates).index(DOC_INDEX).getAll(IDBKeyRange.only(docName)),
      );
      const updates = records
        .map((record) => asBytes((record as Partial<UpdateRecord> | null)?.update))
        .filter((update): update is Uint8Array => update !== null);
      this.counts.set(docName, updates.length);
      if (updates.length >= this.compactThreshold) this.scheduleCompaction(docName);
      if (updates.length === 0) return null;
      return mergeUpdatesSafely(updates, (index, error) =>
        this.errors.emit(
          'load',
          new Error(`Skipped corrupt update ${index + 1} of ${docName}: ${asError(error).message}`),
          docName,
        ),
      );
    } catch (error) {
      this.endLoadBuffer(docName);
      if (!(error instanceof StoreClosedError)) this.errors.emit('load', error, docName);
      throw error;
    }
  }

  storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    if (this.disposed) return Promise.reject(new StoreClosedError('The document store is closed'));
    return new Promise<void>((resolve, reject) => {
      // Copy: callers may reuse the buffer, and the copy is what goes to IndexedDB and other tabs.
      this.queue.push({ docName, update: update.slice(), resolve, reject });
      this.schedulePump();
    });
  }

  compact(docName: string): Promise<void> {
    const running = this.compactions.get(docName);
    if (running) return running;
    const timer = this.compactTimers.get(docName);
    if (timer) {
      clearTimeout(timer);
      this.compactTimers.delete(docName);
    }
    const task = this.runCompaction(docName).finally(() => {
      if (this.compactions.get(docName) === task) this.compactions.delete(docName);
    });
    this.compactions.set(docName, task);
    return task;
  }

  async delete(docName: string): Promise<void> {
    // Queued writes land first, so none can recreate the doc after it is gone.
    await this.flushWrites();
    const timer = this.compactTimers.get(docName);
    if (timer) clearTimeout(timer);
    this.compactTimers.delete(docName);
    await this.compactions.get(docName);
    const db = this.requireDb();
    const transaction = db.transaction(STORES.updates, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    const request = transaction
      .objectStore(STORES.updates)
      .index(DOC_INDEX)
      .openCursor(IDBKeyRange.only(docName));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    try {
      await done;
    } catch (error) {
      this.errors.emit('delete', error, docName);
      throw error;
    }
    this.counts.delete(docName);
    this.endLoadBuffer(docName);
  }

  async list(prefix = ''): Promise<string[]> {
    await this.flushWrites();
    const db = this.requireDb();
    const transaction = db.transaction(STORES.updates, 'readonly');
    const range = prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : null;
    const request = transaction
      .objectStore(STORES.updates)
      .index(DOC_INDEX)
      .openKeyCursor(range, 'nextunique');
    const names: string[] = [];
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (typeof cursor.key === 'string') names.push(cursor.key);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Could not list docs'));
    });
    return names.sort();
  }

  watch(docName: string, onUpdate: (update: Uint8Array) => void): () => void {
    let set = this.watchers.get(docName);
    if (!set) {
      set = new Set();
      this.watchers.set(docName, set);
    }
    set.add(onUpdate);
    const buffered = this.loadBuffers.get(docName);
    if (buffered) {
      this.endLoadBuffer(docName);
      for (const update of buffered.updates) this.deliver(onUpdate, update, docName);
    }
    return () => {
      set.delete(onUpdate);
      if (set.size === 0 && this.watchers.get(docName) === set) this.watchers.delete(docName);
    };
  }

  /** Resolves when every write so far is durable (or failed and was reported). */
  async flush(): Promise<void> {
    await this.flushWrites();
  }

  /** Waits for pending writes and running compactions, then closes the database. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.flushWrites();
    this.disposed = true;
    for (const timer of this.compactTimers.values()) clearTimeout(timer);
    this.compactTimers.clear();
    await Promise.allSettled([...this.compactions.values()]);
    for (const { timer } of this.loadBuffers.values()) clearTimeout(timer);
    this.loadBuffers.clear();
    this.watchers.clear();
    this.errors.clear();
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.db?.close();
    this.db = null;
  }

  /** Number of stored updates of a doc (tests and diagnostics). */
  async updateCount(docName: string): Promise<number> {
    await this.flushWrites();
    const db = this.requireDb();
    const transaction = db.transaction(STORES.updates, 'readonly');
    return requestToPromise(
      transaction.objectStore(STORES.updates).index(DOC_INDEX).count(IDBKeyRange.only(docName)),
    );
  }

  // Writing.

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    // Gather the updates of one tick (a transaction often emits several) into one commit.
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.writing || this.queue.length === 0) return;
    const batch = this.queue.splice(0, MAX_BATCH);
    const writing = this.writeBatch(batch).finally(() => {
      if (this.writing === writing) this.writing = null;
      this.pump();
    });
    this.writing = writing;
  }

  private async flushWrites(): Promise<void> {
    for (;;) {
      if (!this.writing && this.queue.length > 0) this.pump();
      const writing = this.writing;
      if (!writing) return;
      await writing;
    }
  }

  private async writeBatch(batch: QueuedWrite[]): Promise<void> {
    try {
      const db = this.requireDb();
      const transaction = db.transaction(STORES.updates, 'readwrite', { durability: 'strict' });
      const done = transactionDone(transaction);
      try {
        const store = transaction.objectStore(STORES.updates);
        for (const write of batch)
          store.add({ doc: write.docName, update: write.update } satisfies UpdateRecord);
      } catch (error) {
        // Never commit half a batch: every caller retries the whole batch.
        try {
          transaction.abort();
        } catch {
          // Already finished.
        }
        done.catch(() => undefined);
        throw error;
      }
      await done;
    } catch (error) {
      const err = asError(error);
      if (!(err instanceof StoreClosedError) || this.closedReason)
        this.errors.emit('store', err, batch[0]?.docName);
      for (const write of batch) write.reject(err);
      return;
    }
    this.errors.recovered();
    const perDoc = new Map<string, number>();
    for (const write of batch) {
      perDoc.set(write.docName, (perDoc.get(write.docName) ?? 0) + 1);
      write.resolve();
    }
    for (const [docName, added] of perDoc) this.noteStored(docName, added);
    this.broadcast(batch);
  }

  private broadcast(batch: QueuedWrite[]): void {
    if (!this.channel) return;
    const message: UpdatesMessage = {
      v: 1,
      type: 'updates',
      source: this.source,
      items: batch.map((write) => ({ doc: write.docName, update: write.update })),
    };
    try {
      this.channel.postMessage(message);
    } catch (error) {
      console.error('[sync] could not notify other tabs', error);
    }
  }

  // Reading other tabs' writes.

  private receive(data: unknown): void {
    if (this.disposed || !isUpdatesMessage(data) || data.source === this.source) return;
    for (const item of data.items) {
      const update = asBytes(item?.update);
      if (typeof item?.doc !== 'string' || !update) continue;
      this.counts.set(item.doc, (this.counts.get(item.doc) ?? 0) + 1);
      this.loadBuffers.get(item.doc)?.updates.push(update);
      for (const watcher of [...(this.watchers.get(item.doc) ?? [])])
        this.deliver(watcher, update, item.doc);
    }
  }

  private deliver(watcher: (update: Uint8Array) => void, update: Uint8Array, docName: string) {
    try {
      watcher(update);
    } catch (error) {
      console.error(`[sync] applying another tab's update to ${docName} failed`, error);
    }
  }

  private beginLoadBuffer(docName: string): void {
    if (this.loadBuffers.has(docName)) return;
    const timer = setTimeout(() => this.loadBuffers.delete(docName), LOAD_BUFFER_MS);
    this.loadBuffers.set(docName, { updates: [], timer });
  }

  private endLoadBuffer(docName: string): void {
    const buffer = this.loadBuffers.get(docName);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    this.loadBuffers.delete(docName);
  }

  // Compaction.

  private noteStored(docName: string, added: number): void {
    const count = (this.counts.get(docName) ?? 0) + added;
    this.counts.set(docName, count);
    if (count >= this.compactThreshold) this.scheduleCompaction(docName);
  }

  private scheduleCompaction(docName: string): void {
    if (this.disposed || this.compactTimers.has(docName) || this.compactions.has(docName)) return;
    const timer = setTimeout(() => {
      this.compactTimers.delete(docName);
      if (this.disposed) return;
      this.compact(docName).catch((error: unknown) => {
        console.error(`[sync] background compaction of ${docName} failed`, error);
      });
    }, this.compactDelayMs);
    this.compactTimers.set(docName, timer);
  }

  private async runCompaction(docName: string): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(STORES.updates, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORES.updates);
    const keys: IDBValidKey[] = [];
    const updates: Uint8Array[] = [];
    let remaining: number | null = null;
    let failure: Error | null = null;
    const request = store.index(DOC_INDEX).openCursor(IDBKeyRange.only(docName));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        keys.push(cursor.primaryKey);
        const update = asBytes((cursor.value as Partial<UpdateRecord> | null)?.update);
        if (update) updates.push(update);
        cursor.continue();
        return;
      }
      if (keys.length < 2) {
        remaining = keys.length;
        return;
      }
      // Still inside the transaction: nothing else can write this store until it commits.
      let merged: Uint8Array;
      try {
        merged = compactUpdates(updates);
      } catch (error) {
        failure = asError(error);
        transaction.abort();
        return;
      }
      for (const key of keys) store.delete(key);
      store.add({ doc: docName, update: merged } satisfies UpdateRecord);
      remaining = 1;
    };
    try {
      await done;
    } catch (error) {
      const err = failure ?? asError(error);
      this.errors.emit('compact', err, docName);
      throw err;
    }
    if (remaining !== null) this.counts.set(docName, remaining);
  }

  // Lifecycle.

  private requireDb(): IDBDatabase {
    if (this.closedReason) throw new StoreClosedError(this.closedReason);
    if (this.disposed || !this.db) throw new StoreClosedError('The document store is closed');
    return this.db;
  }

  private closeFromOtherTab(): void {
    this.closedReason =
      'This workspace was deleted or upgraded in another tab. Reload the page to continue.';
    this.db = null;
    this.errors.emit('store', new StoreClosedError(this.closedReason));
  }
}
