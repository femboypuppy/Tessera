import { newId, pageDocName, type AppContext, type WorkspaceApi } from '@tessera/core';
import * as Y from 'yjs';
import type { ServerApi } from '../client/api';
import { ServerApiError } from '../client/errors';
import { signalOutbox } from '../provider/shared';
import type { SyncStateStore } from '../stores/sync-state';
import { contentOf, currentContent, restoreInto, sameContent } from './snapshots';
import {
  newestFirst,
  nextVersionSeq,
  type LocalVersionStore,
  type VersionKind,
  type VersionMeta,
  type VersionRecord,
} from './version-store';

/** A version in the history list, and where it is available. */
export interface ListedVersion extends VersionMeta {
  onDevice: boolean;
  onServer: boolean;
}

export interface HistoryServerLink {
  api: ServerApi;
  syncState: SyncStateStore;
}

export interface HistoryOptions {
  /** An automatic version is taken this long after the first unsaved edit. Default 3 minutes. */
  autoDelayMs?: number;
  server?: HistoryServerLink | null;
  now?: () => number;
}

/** The list of a page's versions, and whether the server's part could be loaded. */
export interface HistoryList {
  versions: ListedVersion[];
  serverAvailable: boolean;
}

/**
 * Version history of pages. Automatic versions are taken a few minutes after editing starts
 * (and every few minutes while it continues), never twice for the same content; "Save version"
 * takes one now. Versions are stored on this device and, when the workspace syncs, uploaded to
 * the server (through the outbox, so offline versions upload later). Restoring writes the old
 * content as a new edit, after saving the current content as a "before restore" version.
 */
export class HistoryService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly offs: Array<() => void> = [];
  private readonly listeners = new Set<(pageId: string) => void>();
  private readonly now: () => number;
  private disposed = false;

  constructor(
    private readonly ctx: AppContext,
    readonly store: LocalVersionStore,
    private readonly options: HistoryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.offs.push(
      this.ctx.events.on('doc.changed', ({ pageId, local }) => {
        if (local) this.scheduleAuto(pageId);
      }),
      this.ctx.events.on('page.deleted', ({ pageId }) => {
        this.cancel(pageId);
        // The page is gone for good: so is its history on this device (the server deletes its
        // copy with the doc).
        void this.store
          .deleteForDoc(pageDocName(pageId))
          .catch((error: unknown) =>
            console.error('[sync] could not delete a page history', error),
          );
      }),
    );
  }

  /** Called with the page ID whenever a version of it is saved on this device. */
  onChange(listener: (pageId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    for (const off of this.offs.splice(0)) off();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Saves a version of a page now. Returns null when an automatic one would change nothing. */
  async saveVersion(
    pageId: string,
    options: { kind: VersionKind; label?: string | null } = { kind: 'manual' },
  ): Promise<VersionRecord | null> {
    const handle = await this.ctx.loadPageDoc(pageId);
    try {
      return await this.snapshot(pageId, handle.doc, options.kind, options.label ?? null);
    } finally {
      handle.release();
    }
  }

  /** A page's versions: this device's and the server's, newest first. */
  async list(pageId: string): Promise<HistoryList> {
    const docName = pageDocName(pageId);
    const local = await this.store.list(docName);
    const byId = new Map<string, ListedVersion>(
      local.map((version) => [version.id, { ...version, onDevice: true, onServer: false }]),
    );
    let serverAvailable = !this.options.server;
    if (this.options.server) {
      try {
        for (const version of await this.options.server.api.versions(
          this.ctx.workspace.info.id,
          docName,
        )) {
          const existing = byId.get(version.id);
          if (existing) existing.onServer = true;
          else byId.set(version.id, { ...version, onDevice: false, onServer: true });
        }
        serverAvailable = true;
      } catch (error) {
        if (!(error instanceof ServerApiError)) throw error;
      }
    }
    return {
      versions: [...byId.values()].sort(newestFirst),
      serverAvailable,
    };
  }

  /** The Yjs state of a version (from this device, or downloaded). */
  async stateOf(version: Pick<ListedVersion, 'id' | 'onDevice'>): Promise<Uint8Array> {
    const local = await this.store.get(version.id);
    if (local) return local.state;
    if (!this.options.server) throw new Error('This version is not on this device.');
    const { state } = await this.options.server.api.version(this.ctx.workspace.info.id, version.id);
    return state;
  }

  /**
   * Restores a version as a new edit. The current content is saved first (as "before restore");
   * the returned `undo` reverts the restore itself (use it before `dispose`).
   */
  async restore(
    pageId: string,
    version: Pick<ListedVersion, 'id' | 'onDevice'>,
  ): Promise<{ undo(): boolean; dispose(): void }> {
    const state = await this.stateOf(version);
    const content = contentOf(state);
    const handle = await this.ctx.loadPageDoc(pageId);
    try {
      await this.snapshot(pageId, handle.doc, 'restore', null);
      const restored = restoreInto(handle.doc, content);
      let released = false;
      return {
        undo: () => restored.undo(),
        dispose: () => {
          if (released) return;
          released = true;
          restored.dispose();
          handle.release();
        },
      };
    } catch (error) {
      handle.release();
      throw error;
    }
  }

  private scheduleAuto(pageId: string): void {
    if (this.disposed || this.timers.has(pageId)) return;
    const page = this.ctx.workspace.getPage(pageId);
    if (!page || page.kind !== 'page') return;
    const timer = setTimeout(
      () => {
        this.timers.delete(pageId);
        if (this.disposed || !this.ctx.workspace.getPage(pageId)) return;
        this.saveVersion(pageId, { kind: 'auto' }).catch((error: unknown) =>
          console.warn('[sync] automatic version failed', error),
        );
      },
      this.options.autoDelayMs ?? 3 * 60_000,
    );
    this.timers.set(pageId, timer);
  }

  private cancel(pageId: string): void {
    const timer = this.timers.get(pageId);
    if (timer) clearTimeout(timer);
    this.timers.delete(pageId);
  }

  private async snapshot(
    pageId: string,
    doc: Y.Doc,
    kind: VersionKind,
    label: string | null,
  ): Promise<VersionRecord | null> {
    const docName = pageDocName(pageId);
    const state = Y.encodeStateAsUpdate(doc);
    if (kind !== 'manual') {
      const latest = await this.store.latest(docName);
      if (latest && sameContent(contentOf(latest.state), currentContent(doc))) return null;
    }
    const user = this.ctx.currentUser;
    const record: VersionRecord = {
      id: newId(),
      docName,
      createdAt: this.now(),
      createdBy: user.id,
      authorName: user.name || null,
      label: label?.trim() ? label.trim().slice(0, 200) : null,
      kind,
      size: state.byteLength,
      seq: nextVersionSeq(),
      state,
      uploaded: !this.options.server,
    };
    await this.store.add(record);
    for (const listener of [...this.listeners]) listener(pageId);
    const server = this.options.server;
    if (server) {
      await server.syncState.enqueue({ kind: 'uploadVersion', versionId: record.id });
      signalOutbox(this.ctx.workspace.info.id);
    }
    return record;
  }
}

const services = new WeakMap<WorkspaceApi, HistoryService | null>();

/**
 * Registers the history of a session (keyed by its workspace API, which every context of the
 * session shares). `null` means history is unavailable here (no IndexedDB).
 */
export function setHistoryService(ctx: AppContext, service: HistoryService | null): void {
  services.set(ctx.workspace, service);
}

export function clearHistoryService(ctx: AppContext): void {
  services.delete(ctx.workspace);
}

/** The session's history: the service, null when unavailable, undefined before activation. */
export function historyServiceOf(ctx: AppContext): HistoryService | null | undefined {
  return services.get(ctx.workspace);
}
