import { IndexCore, type ChangeSummary } from './index-core';
import type { IndexPersistence } from './persistence';
import type { IndexRequest, IndexResults, IndexRequestType } from './protocol';

export interface IndexRuntimeOptions {
  persistence: IndexPersistence | null;
  /** Called after changes that may affect results (the host throttles and fans out). */
  notify: (change: ChangeSummary) => void;
  now?: () => number;
  /**
   * Save this long after the last change. Default 10 s: saving serializes the whole index (about
   * a second of worker time for 5,000 pages), so it waits for a quiet moment; the host also asks
   * for a save when the tab is hidden and when the session closes.
   */
  saveDelayMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * The worker side of the index: owns the {@link IndexCore}, runs requests strictly in order, and
 * saves the index (debounced, and on `flush`). The worker entry and the in-process transport both
 * wrap one.
 */
export class IndexRuntime {
  private core: IndexCore;
  private workspaceId: string | null = null;
  private persist = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: IndexRuntimeOptions) {
    this.core = new IndexCore({ now: options.now });
  }

  /** Queues a request behind every earlier one and resolves with its result. */
  handle<T extends IndexRequestType>(
    request: Extract<IndexRequest, { type: T }>,
  ): Promise<IndexResults[T]> {
    const run = this.chain.then(() => this.run(request));
    // Keep the chain alive after failures; the caller still sees the rejection.
    this.chain = run.catch(() => undefined);
    return run as Promise<IndexResults[T]>;
  }

  private async run(request: IndexRequest): Promise<unknown> {
    switch (request.type) {
      case 'init': {
        this.workspaceId = request.workspaceId;
        this.persist = request.persist && this.options.persistence !== null;
        let persisted = null;
        if (this.persist && this.options.persistence) {
          try {
            persisted = await this.options.persistence.load(request.workspaceId);
          } catch (error) {
            this.options.onError?.(error);
          }
        }
        this.core = new IndexCore({ now: this.options.now, persisted });
        return { restored: this.core.restored, documents: this.core.documentCount };
      }
      case 'meta': {
        const stale = this.core.setMeta(request.upserts, request.removes, request.full);
        this.changed({ search: true, links: true });
        return stale;
      }
      case 'content':
        for (const item of request.items) {
          try {
            this.core.setContentFromBytes(item.pageId, item.bytes, item.fingerprint);
          } catch (error) {
            // A doc that cannot be read (corrupt update) must not stop the rest of the batch.
            this.options.onError?.(error);
          }
        }
        this.changed({ search: true, links: true });
        return null;
      case 'database':
        for (const item of request.items) {
          try {
            this.core.setDatabaseFromBytes(item.databaseId, item.bytes, item.fingerprint);
          } catch (error) {
            this.options.onError?.(error);
          }
        }
        this.changed({ search: true, links: false });
        return null;
      case 'remove':
        this.core.removePages(request.pageIds);
        this.changed({ search: true, links: true });
        return null;
      case 'clear':
        this.core.clear();
        this.changed({ search: true, links: true });
        return null;
      case 'query':
        return this.core.query(request.request);
      case 'backlinks':
        return this.core.backlinks(request.pageId);
      case 'outgoing':
        return this.core.outgoing(request.pageId);
      case 'edges':
        return this.core.edges();
      case 'mentionCandidates':
        return this.core.mentionCandidates(request.pageId);
      case 'mentions':
        return this.core.findMentions(request.pageId, request.sources);
      case 'orphans':
        return this.core.orphans();
      case 'tags':
        return this.core.tags();
      case 'tagCooccurrence':
        return this.core.tagCooccurrence();
      case 'graph':
        return this.core.graph();
      case 'neighborhood':
        return this.core.neighborhood(request.pageId, request.depth);
      case 'flush':
        await this.save();
        return null;
      case 'ping':
        return null;
      default:
        return null;
    }
  }

  private changed(change: ChangeSummary): void {
    this.dirty = true;
    this.options.notify(change);
    if (!this.persist) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, this.options.saveDelayMs ?? 10_000);
  }

  /** Saves now if anything changed since the last save. */
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saving;
    if (!this.dirty || !this.persist || !this.workspaceId || !this.options.persistence) return;
    this.dirty = false;
    const snapshot = this.core.toPersisted();
    const persistence = this.options.persistence;
    const key = this.workspaceId;
    this.saving = persistence.save(key, snapshot).catch((error: unknown) => {
      this.dirty = true;
      this.options.onError?.(error);
    });
    await this.saving;
  }

  /** Stops timers (the worker is about to be terminated). */
  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
}
