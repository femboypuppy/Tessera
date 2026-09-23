import type { PageKind } from '../model/page-meta';
import { getPageProps } from '../model/page-doc';
import { extractPlainText, extractTags, extractTasks } from '../schema/extract';
import { tagKey } from '../schema/tags';
import { readDocJSON } from '../schema/ydoc';
import type { DocHandle } from '../runtime/doc-manager';
import type { EventBus } from '../runtime/events';
import type { PagesStore } from '../runtime/pages-store';

/** A `[start, end)` range of UTF-16 offsets into a string, to highlight. */
export interface HighlightRange {
  start: number;
  end: number;
}

/** Options for {@link SearchIndex.query}. Implementations may also parse filters from the query string. */
export interface SearchOptions {
  /** Default 20. */
  limit?: number;
  /** For pagination. Default 0. */
  offset?: number;
  /** Only these page kinds (`type:page`, `type:database`). */
  kinds?: PageKind[];
  /** Only pages inside this page's subtree (`in:`). */
  withinPageId?: string;
  /** Only pages with all of these tags (inline or page-level; `tag:`). */
  tags?: string[];
  /** Only pages that contain tasks (`is:task`). */
  hasTasks?: boolean;
  /** Include database rows (default true). */
  includeRows?: boolean;
  signal?: AbortSignal;
}

/** One search result. */
export interface SearchHit {
  pageId: string;
  /** The page title at indexing time (render the live title from `PageMeta` when you can). */
  title: string;
  kind: PageKind;
  /** Higher is better; only comparable within one query. */
  score: number;
  /** Where the best match was found. */
  matchedIn: 'title' | 'heading' | 'body' | 'tag' | 'property';
  titleHighlights: HighlightRange[];
  /** A short excerpt around the best body match, with highlights into `snippet.text`. */
  snippet?: { text: string; highlights: HighlightRange[] };
  /** Text of the heading that matched best, for `ctx.navigate(pageId, { heading })`. */
  heading?: string;
  /** Block ID of the block that matched best, for `ctx.navigate(pageId, { blockId })`. */
  blockId?: string;
}

/** Results of a query. */
export interface SearchResults {
  hits: SearchHit[];
  /** Total number of matches (for pagination). */
  total: number;
}

/**
 * Full-text search over the workspace. Implementations: naive substring search (core, 0) and
 * MiniSearch in a worker (`@tessera/search`, 50). Implementations keep themselves up to date from
 * the `EventBus` (`page.*`, debounced `doc.changed`, `database.changed`); `upsert`/`remove` force
 * an update. Trashed pages never appear in results.
 *
 * @example
 * const { hits } = await ctx.services.searchIndex.query('apollo tag:space', { limit: 10 });
 */
export interface SearchIndex {
  upsert(pageId: string): Promise<void>;
  remove(pageId: string): Promise<void>;
  query(query: string, options?: SearchOptions): Promise<SearchResults>;
  /** Re-indexes everything (after imports or schema upgrades). */
  rebuild?(): Promise<void>;
  dispose?(): void | Promise<void>;
}

/** What index implementations get to read content. */
export interface IndexSources {
  pages: PagesStore;
  loadPageDoc(pageId: string): Promise<DocHandle>;
  events: EventBus;
}

interface Entry {
  body: string;
  tags: Set<string>;
  hasTasks: boolean;
}

function highlightsFor(text: string, terms: readonly string[]): HighlightRange[] {
  const lower = text.toLocaleLowerCase();
  const ranges: HighlightRange[] = [];
  for (const term of terms) {
    let from = 0;
    for (let at = lower.indexOf(term, from); at >= 0; at = lower.indexOf(term, from)) {
      ranges.push({ start: at, end: at + term.length });
      from = at + term.length;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * Naive {@link SearchIndex}: case-insensitive substring matching of every term, titles ranked
 * above body text. Loads page docs lazily on the first query. Fine for small in-memory workspaces
 * and tests; `@tessera/search` replaces it.
 */
export class NaiveSearchIndex implements SearchIndex {
  private readonly entries = new Map<string, Entry>();
  private readonly offs: Array<() => void> = [];
  private fullyIndexed = false;

  constructor(private readonly sources: IndexSources) {
    const reindex = ({ pageId }: { pageId: string }) => {
      if (this.entries.has(pageId) || this.fullyIndexed) void this.upsert(pageId);
    };
    this.offs.push(
      sources.events.on('doc.changed', reindex),
      sources.events.on('page.deleted', ({ pageId }) => void this.remove(pageId)),
    );
  }

  async upsert(pageId: string): Promise<void> {
    const page = this.sources.pages.getSnapshot().get(pageId);
    if (!page) {
      this.entries.delete(pageId);
      return;
    }
    if (page.kind !== 'page') {
      this.entries.set(pageId, { body: '', tags: new Set(), hasTasks: false });
      return;
    }
    const handle = await this.sources.loadPageDoc(pageId);
    try {
      const doc = readDocJSON(handle.doc);
      const tags = new Set(extractTags(doc).map((tag) => tag.key));
      for (const tag of getPageProps(handle.doc).tags ?? []) tags.add(tagKey(tag));
      const hasTasks = extractTasks(doc).length > 0;
      this.entries.set(pageId, { body: extractPlainText(doc), tags, hasTasks });
    } finally {
      handle.release();
    }
  }

  async remove(pageId: string): Promise<void> {
    this.entries.delete(pageId);
  }

  async rebuild(): Promise<void> {
    this.entries.clear();
    this.fullyIndexed = false;
    await this.ensureIndexed();
  }

  async query(query: string, options: SearchOptions = {}): Promise<SearchResults> {
    await this.ensureIndexed();
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const snapshot = this.sources.pages.getSnapshot();
    const hits: SearchHit[] = [];
    for (const page of snapshot.all()) {
      if (options.signal?.aborted) break;
      if (snapshot.isTrashed(page.id)) continue;
      if (options.includeRows === false && snapshot.isRow(page.id)) continue;
      if (options.kinds && !options.kinds.includes(page.kind)) continue;
      if (
        options.withinPageId &&
        !snapshot.ancestors(page.id).some((a) => a.id === options.withinPageId)
      )
        continue;
      const entry = this.entries.get(page.id);
      if (options.tags?.length && !options.tags.every((tag) => entry?.tags.has(tagKey(tag))))
        continue;
      if (options.hasTasks && !entry?.hasTasks) continue;
      const title = page.title.toLocaleLowerCase();
      const body = entry?.body.toLocaleLowerCase() ?? '';
      if (!terms.every((term) => title.includes(term) || body.includes(term))) continue;
      const titleHits = terms.filter((term) => title.includes(term)).length;
      const hit: SearchHit = {
        pageId: page.id,
        title: page.title,
        kind: page.kind,
        score: titleHits * 10 + (title.startsWith(terms[0] ?? '') ? 5 : 0) + 1,
        matchedIn: titleHits > 0 ? 'title' : 'body',
        titleHighlights: highlightsFor(page.title, terms),
      };
      const first = terms
        .map((term) => body.indexOf(term))
        .filter((at) => at >= 0)
        .sort((a, b) => a - b)[0];
      if (entry && first !== undefined) {
        const start = Math.max(0, first - 40);
        const text = entry.body.slice(start, start + 160).replace(/\n/g, ' ');
        hit.snippet = { text, highlights: highlightsFor(text, terms) };
      }
      hits.push(hit);
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    const offset = options.offset ?? 0;
    return { hits: hits.slice(offset, offset + (options.limit ?? 20)), total: hits.length };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.entries.clear();
  }

  private async ensureIndexed(): Promise<void> {
    if (this.fullyIndexed) return;
    for (const page of this.sources.pages.getSnapshot().all()) {
      if (!this.entries.has(page.id)) await this.upsert(page.id);
    }
    this.fullyIndexed = true;
  }
}
