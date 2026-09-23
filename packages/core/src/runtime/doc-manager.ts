import * as Y from 'yjs';
import { toError } from '../errors';
import {
  databaseDocName,
  pageDocName,
  parseDocName,
  workspaceDocName,
  type DocKind,
} from '../model/doc-names';
import type { DocStore } from '../services/doc-store';
import type { SyncHandle, SyncProvider } from '../services/sync-provider';
import type { CurrentUser } from './user';

/** Transaction origin of updates applied from the `DocStore` (initial load and other tabs). */
export const STORE_ORIGIN = Symbol('tessera:store');

/**
 * A lease on an open Y.Doc. Every `acquire*` call returns a new lease; the doc stays open while at
 * least one lease is held, and closes a few seconds after the last `release()` (so navigating back
 * and forth does not reload). `release()` is idempotent.
 *
 * The doc is usable immediately, but **await `whenLoaded` before writing structure** (creating a
 * title property, initial content): the stored state may not have arrived yet, and CRDTs happily
 * merge two "initial" structures into duplicates.
 *
 * @example
 * const handle = ctx.acquirePageDoc(pageId);
 * await handle.whenLoaded;
 * const doc = readDocJSON(handle.doc);
 * handle.release();
 */
export interface DocHandle {
  readonly docName: string;
  readonly kind: DocKind;
  /** Page, database or workspace ID. */
  readonly id: string;
  readonly doc: Y.Doc;
  readonly isLoaded: boolean;
  /** Resolves once the stored state is applied and sync is connected; rejects if loading failed. */
  readonly whenLoaded: Promise<void>;
  /** The loading error, if any. */
  readonly error: Error | null;
  /** The sync connection (with awareness), available once loaded. */
  readonly sync: SyncHandle | null;
  release(): void;
}

/** A change to an open doc (from any source except the initial load). */
export interface DocUpdateEvent {
  docName: string;
  kind: DocKind;
  id: string;
  /** True for changes made in this process, false for sync and other tabs. */
  local: boolean;
  origin: unknown;
}

export interface DocManagerOptions {
  docStore: DocStore;
  syncProvider: SyncProvider;
  getUser?: () => CurrentUser;
  /** Delay before closing a doc after its last release. Default 5000 ms; tests use 0. */
  releaseDelayMs?: number;
  /** Compact a doc on close when it received this many stored updates. Default 200. */
  compactAfterUpdates?: number;
  onDocUpdate?: (event: DocUpdateEvent) => void;
  onError?: (
    error: Error,
    context: { docName: string; operation: 'load' | 'store' | 'compact' | 'delete' },
  ) => void;
}

interface Entry {
  docName: string;
  kind: DocKind;
  id: string;
  doc: Y.Doc;
  refs: number;
  loaded: boolean;
  error: Error | null;
  whenLoaded: Promise<void>;
  sync: SyncHandle | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  pending: Set<Promise<void>>;
  failed: Uint8Array[];
  storedSinceLoad: number;
  unwatch: (() => void) | null;
  closed: boolean;
  deleted: boolean;
}

/**
 * Opens, persists, syncs and closes Y.Docs with reference counting. One per workspace session;
 * features use it through `AppContext.acquirePageDoc` / `acquireDatabaseDoc`.
 *
 * - Every local or remote update is stored through the `DocStore` (failed writes are retried with
 *   the next write and on `flush()`), except updates that came from the store itself.
 * - Docs connect to the `SyncProvider` after loading; the awareness `user` field is kept equal to
 *   the current user.
 * - Closing waits for pending writes; reopening a closing doc waits for the close to finish, so a
 *   reload never misses a write.
 */
export class DocManager {
  private readonly entries = new Map<string, Entry>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly options: Required<
    Pick<DocManagerOptions, 'releaseDelayMs' | 'compactAfterUpdates'>
  > &
    DocManagerOptions;
  private user: CurrentUser | null;
  private disposed = false;

  constructor(options: DocManagerOptions) {
    this.options = { releaseDelayMs: 5000, compactAfterUpdates: 200, ...options };
    this.user = options.getUser?.() ?? null;
  }

  acquirePageDoc(pageId: string): DocHandle {
    return this.acquire(pageDocName(pageId));
  }

  acquireDatabaseDoc(databaseId: string): DocHandle {
    return this.acquire(databaseDocName(databaseId));
  }

  acquireWorkspaceDoc(workspaceId: string): DocHandle {
    return this.acquire(workspaceDocName(workspaceId));
  }

  /** Acquires a doc by name and returns a new lease on it. */
  acquire(docName: string): DocHandle {
    if (this.disposed) throw new Error('The workspace session is closed');
    let entry = this.entries.get(docName);
    if (!entry) entry = this.open(docName);
    entry.refs += 1;
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
      entry.releaseTimer = null;
    }
    return this.lease(entry);
  }

  /** Acquires and waits until loaded. Releases the lease and rethrows when loading fails. */
  async load(docName: string): Promise<DocHandle> {
    const handle = this.acquire(docName);
    try {
      await handle.whenLoaded;
      return handle;
    } catch (error) {
      handle.release();
      throw error;
    }
  }

  /** Names of the docs currently open. */
  openDocNames(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** Updates the awareness `user` field of every open doc. */
  setUser(user: CurrentUser): void {
    this.user = user;
    for (const entry of this.entries.values()) this.applyUser(entry);
  }

  /** Resolves when every write so far is stored (retrying failed writes once). */
  async flush(): Promise<void> {
    await Promise.all([...this.entries.values()].flatMap((entry) => [...entry.pending]));
    await Promise.all([...this.entries.values()].map((entry) => this.retryFailed(entry)));
    await Promise.all([...this.closing.values()]);
    await this.options.docStore.flush?.();
  }

  /** Closes the doc if open (waiting for its writes), then deletes it from the store. */
  async deleteDoc(docName: string): Promise<void> {
    const entry = this.entries.get(docName);
    if (entry) {
      entry.deleted = true;
      await this.close(entry, true);
    }
    await this.closing.get(docName);
    try {
      await this.options.docStore.delete(docName);
    } catch (error) {
      this.report(error, docName, 'delete');
      throw error;
    }
  }

  /** Closes every doc (ignoring leases), after storing pending writes. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.entries.values()].map((entry) => this.close(entry, true)));
    await Promise.all([...this.closing.values()]);
    await this.options.docStore.flush?.();
  }

  private open(docName: string): Entry {
    const parsed = parseDocName(docName);
    const doc = new Y.Doc({ guid: docName });
    const entry: Entry = {
      docName,
      kind: parsed?.kind ?? 'page',
      id: parsed?.id ?? docName,
      doc,
      refs: 0,
      loaded: false,
      error: null,
      whenLoaded: Promise.resolve(),
      sync: null,
      releaseTimer: null,
      pending: new Set(),
      failed: [],
      storedSinceLoad: 0,
      unwatch: null,
      closed: false,
      deleted: false,
    };
    doc.on(
      'update',
      (update: Uint8Array, origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
        if (entry.deleted) return;
        if (origin !== STORE_ORIGIN) this.persist(entry, update);
        if (origin === STORE_ORIGIN && !entry.loaded) return;
        this.options.onDocUpdate?.({
          docName,
          kind: entry.kind,
          id: entry.id,
          local: origin !== STORE_ORIGIN && transaction.local,
          origin,
        });
      },
    );
    const prior = this.closing.get(docName);
    entry.whenLoaded = (async () => {
      if (prior) await prior;
      try {
        const stored = await this.options.docStore.load(docName);
        if (entry.closed) return;
        if (stored) Y.applyUpdate(doc, stored, STORE_ORIGIN);
        entry.unwatch =
          this.options.docStore.watch?.(docName, (update) => {
            if (!entry.closed) Y.applyUpdate(doc, update, STORE_ORIGIN);
          }) ?? null;
        entry.sync = this.options.syncProvider.connect(docName, doc);
        this.applyUser(entry);
        entry.loaded = true;
      } catch (error) {
        entry.error = toError(error);
        this.report(error, docName, 'load');
        throw entry.error;
      }
    })();
    entry.whenLoaded.catch(() => undefined);
    this.entries.set(docName, entry);
    return entry;
  }

  private lease(entry: Entry): DocHandle {
    let released = false;
    return {
      docName: entry.docName,
      kind: entry.kind,
      id: entry.id,
      doc: entry.doc,
      get isLoaded() {
        return entry.loaded;
      },
      whenLoaded: entry.whenLoaded,
      get error() {
        return entry.error;
      },
      get sync() {
        return entry.sync;
      },
      release: () => {
        if (released) return;
        released = true;
        this.release(entry);
      },
    };
  }

  private release(entry: Entry): void {
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0 || entry.closed) return;
    if (this.options.releaseDelayMs <= 0) {
      void this.close(entry, false);
    } else {
      entry.releaseTimer = setTimeout(
        () => void this.close(entry, false),
        this.options.releaseDelayMs,
      );
    }
  }

  private close(entry: Entry, force: boolean): Promise<void> {
    if (entry.closed || (!force && entry.refs > 0))
      return this.closing.get(entry.docName) ?? Promise.resolve();
    entry.closed = true;
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    this.entries.delete(entry.docName);
    entry.sync?.destroy();
    entry.unwatch?.();
    const done = (async () => {
      await Promise.all([...entry.pending]);
      if (!entry.deleted) {
        await this.retryFailed(entry);
        if (entry.storedSinceLoad >= this.options.compactAfterUpdates) {
          try {
            await this.options.docStore.compact(entry.docName);
          } catch (error) {
            this.report(error, entry.docName, 'compact');
          }
        }
      }
      entry.doc.destroy();
    })();
    this.closing.set(entry.docName, done);
    void done.finally(() => {
      if (this.closing.get(entry.docName) === done) this.closing.delete(entry.docName);
    });
    return done;
  }

  private persist(entry: Entry, update: Uint8Array): void {
    const payload = entry.failed.length ? Y.mergeUpdates([...entry.failed, update]) : update;
    entry.failed = [];
    const write: Promise<void> = this.options.docStore
      .storeUpdate(entry.docName, payload)
      .then(
        () => {
          entry.storedSinceLoad += 1;
        },
        (error: unknown) => {
          entry.failed.push(payload);
          this.report(error, entry.docName, 'store');
        },
      )
      .finally(() => {
        entry.pending.delete(write);
      });
    entry.pending.add(write);
  }

  private async retryFailed(entry: Entry): Promise<void> {
    if (!entry.failed.length) return;
    const payload = Y.mergeUpdates(entry.failed);
    entry.failed = [];
    try {
      await this.options.docStore.storeUpdate(entry.docName, payload);
    } catch (error) {
      entry.failed.push(payload);
      this.report(error, entry.docName, 'store');
    }
  }

  private applyUser(entry: Entry): void {
    if (!entry.sync || !this.user) return;
    const { id, name, color } = this.user;
    entry.sync.awareness.setLocalStateField('user', { id, name, color });
  }

  private report(
    error: unknown,
    docName: string,
    operation: 'load' | 'store' | 'compact' | 'delete',
  ): void {
    const err = toError(error);
    if (this.options.onError) this.options.onError(err, { docName, operation });
    else console.error(`[docs] ${operation} failed for ${docName}`, err);
  }
}
