import { ValidationError, type DocStore, type WorkspaceInfo } from '@tessera/core';
import * as Y from 'yjs';
import type { DesktopBackend } from '../backend/backend';
import { fromBase64, type WorkspaceStatus } from '../backend/protocol';
import { registerFlushable } from '../runtime';

/**
 * {@link DocStore} on the workspace folder's `tessera.db` (SQLite, through Rust commands).
 *
 * - `storeUpdate` resolves once the row is committed with `synchronous = FULL`.
 * - `compact` merges what it read and replaces only the rows up to the last one it read, so
 *   updates stored meanwhile are kept.
 * - `watch` receives updates stored by the app's other window (quick capture), relayed by Rust.
 * - The folder and database are created on the first write, never on open.
 *
 * @example
 * const store = await TauriDocStore.open(backend, workspace);
 * await store.storeUpdate('page:abc', update);
 */
export class TauriDocStore implements DocStore {
  readonly status: WorkspaceStatus;
  private readonly pending = new Set<Promise<void>>();
  private readonly watchers = new Map<string, Set<(update: Uint8Array) => void>>();
  private offEvents: (() => void) | null = null;
  private readonly offFlush: () => void;
  private disposed = false;

  private constructor(
    private readonly backend: DesktopBackend,
    private readonly workspaceId: string,
    status: WorkspaceStatus,
  ) {
    this.status = status;
    this.offFlush = registerFlushable(() => this.flush());
  }

  /** Attaches the workspace folder in the Rust side (reference counted) and returns a store. */
  static async open(backend: DesktopBackend, workspace: WorkspaceInfo): Promise<TauriDocStore> {
    if (!workspace.path) throw new ValidationError(`Workspace "${workspace.name}" has no folder`);
    const status = await backend.attachWorkspace(workspace.id, workspace.path, workspace.name);
    return new TauriDocStore(backend, workspace.id, status);
  }

  async load(docName: string): Promise<Uint8Array | null> {
    const { updates } = await this.backend.loadDoc(this.workspaceId, docName);
    if (updates.length === 0) return null;
    return updates.length === 1 ? (updates[0] ?? null) : Y.mergeUpdates(updates);
  }

  storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    const write = this.backend.storeUpdate(this.workspaceId, docName, update);
    this.pending.add(write);
    void write.then(
      () => this.pending.delete(write),
      () => this.pending.delete(write),
    );
    return write;
  }

  async compact(docName: string): Promise<void> {
    const { maxSeq, updates } = await this.backend.loadDoc(this.workspaceId, docName);
    if (updates.length < 2) return;
    // Applying to a doc (with garbage collection) drops deleted content before storing.
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Y.mergeUpdates(updates));
      await this.backend.compactDoc(this.workspaceId, docName, maxSeq, Y.encodeStateAsUpdate(doc));
    } finally {
      doc.destroy();
    }
  }

  delete(docName: string): Promise<void> {
    return this.backend.deleteDoc(this.workspaceId, docName);
  }

  list(prefix = ''): Promise<string[]> {
    return this.backend.listDocs(this.workspaceId, prefix);
  }

  watch(docName: string, onUpdate: (update: Uint8Array) => void): () => void {
    let set = this.watchers.get(docName);
    if (!set) {
      set = new Set();
      this.watchers.set(docName, set);
    }
    set.add(onUpdate);
    this.offEvents ??= this.backend.onDocUpdate((event) => {
      if (event.workspaceId !== this.workspaceId || event.origin === this.backend.windowLabel)
        return;
      const listeners = this.watchers.get(event.docName);
      if (!listeners?.size) return;
      const update = fromBase64(event.update);
      for (const listener of [...listeners]) listener(update);
    });
    return () => {
      set.delete(onUpdate);
      if (set.size === 0) this.watchers.delete(docName);
    };
  }

  async flush(): Promise<void> {
    // Writes that fail are retried by the DocManager; here we only wait for them to settle.
    await Promise.allSettled([...this.pending]);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.flush();
    this.offEvents?.();
    this.offEvents = null;
    this.watchers.clear();
    this.offFlush();
    await this.backend.detachWorkspace(this.workspaceId);
  }
}
