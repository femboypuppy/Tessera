import type { SearchIndex, SearchOptions } from '@tessera/core';
import type { ChangeSummary } from '../engine/index-core';
import type { RichSearchHit, TagCount } from '../engine/types';
import type { IndexHost, IndexStatus } from './index-host';

/** Results of {@link MiniSearchIndex.query}: the contract's results with richer hits. */
export interface RichSearchResults {
  hits: RichSearchHit[];
  total: number;
  /** Time the engine took, in ms (not counting the round trip to the worker). */
  tookMs: number;
}

/**
 * The MiniSearch {@link SearchIndex} (priority 50): titles (strongly boosted), aliases, tags,
 * headings, database row values and body text, with fuzzy and prefix matching, snippets, the
 * `tag:`/`in:`/`type:`/`is:task` filters, and ranking that also weighs recency and backlinks.
 * Indexing runs in a worker and is persisted; see {@link IndexHost}.
 *
 * @example
 * const { hits } = await ctx.services.searchIndex.query('apollo tag:space', { limit: 10 });
 */
export class MiniSearchIndex implements SearchIndex {
  constructor(readonly host: IndexHost) {}

  upsert(pageId: string): Promise<void> {
    return this.host.upsert(pageId);
  }

  remove(pageId: string): Promise<void> {
    return this.host.remove(pageId);
  }

  query(query: string, options?: SearchOptions): Promise<RichSearchResults> {
    return this.host.query(query, options);
  }

  rebuild(): Promise<void> {
    return this.host.rebuild();
  }

  /** Every tag in use, most used first. */
  tags(): Promise<TagCount[]> {
    return this.host.tags();
  }

  /** Resolves once everything queued so far is indexed. */
  whenIdle(): Promise<void> {
    return this.host.whenIdle();
  }

  get status(): IndexStatus {
    return this.host.status;
  }

  subscribeStatus(listener: () => void): () => void {
    return this.host.subscribeStatus(listener);
  }

  /** Called (throttled) when results may have changed. */
  subscribe(listener: () => void): () => void {
    return this.host.subscribe((change: ChangeSummary) => {
      if (change.search) listener();
    });
  }

  dispose(): Promise<void> {
    return this.host.release();
  }
}
