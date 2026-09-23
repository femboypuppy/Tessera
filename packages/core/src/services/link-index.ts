import { getPageProps } from '../model/page-doc';
import { extractLinks, type ExtractedLink } from '../schema/extract';
import { findTextOccurrences } from '../schema/mentions';
import type { DocJSON } from '../schema/types';
import { readDocJSON } from '../schema/ydoc';
import type { IndexSources } from './search-index';

/** A link from another page to the target page. */
export interface Backlink {
  sourcePageId: string;
  targetPageId: string;
  label: string | null;
  heading: string | null;
  blockRef: string | null;
  /** Display text of the block that contains the link (the context shown in the panel). */
  blockText: string;
  /** Path of that block in the source document, and the link's inline offset. */
  path: number[];
  offset: number;
  /** Block ID of the containing block (or its nearest container), or null: scroll targets. */
  blockId: string | null;
}

/**
 * The target page's title (or an alias) written as plain text in another page. Pass it to
 * `replaceTextWithPageLink` (with `expectedText: text`) to turn it into a link.
 */
export interface UnlinkedMention {
  sourcePageId: string;
  targetPageId: string;
  path: number[];
  from: number;
  to: number;
  /** The text as written. */
  text: string;
  blockText: string;
}

/** A graph edge: `source` links to `target` `count` times. */
export interface LinkEdge {
  source: string;
  target: string;
  count: number;
}

/**
 * The link graph. Implementations: naive scan (core, 0) and a graphology-backed index
 * (`@tessera/search`, 50). Self-links are not backlinks; links from trashed pages are ignored.
 * `subscribe` notifies when the graph may have changed (backlink panels and the graph re-query).
 *
 * @example
 * const backlinks = await ctx.services.linkIndex.backlinks(pageId);
 */
export interface LinkIndex {
  backlinks(pageId: string): Promise<Backlink[]>;
  outgoing(pageId: string): Promise<ExtractedLink[]>;
  unlinkedMentions(pageId: string): Promise<UnlinkedMention[]>;
  edges(): Promise<LinkEdge[]>;
  subscribe(listener: () => void): () => void;
  dispose?(): void | Promise<void>;
}

interface Source {
  doc: DocJSON;
  links: ExtractedLink[];
  aliases: string[];
}

/**
 * Naive {@link LinkIndex}: reads every page doc once (lazily), then re-reads pages on
 * `doc.changed`. Fine for small workspaces and tests; `@tessera/search` replaces it.
 */
export class NaiveLinkIndex implements LinkIndex {
  private readonly sources = new Map<string, Source>();
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];
  private scanned = false;

  constructor(private readonly input: IndexSources) {
    const changed = async ({ pageId }: { pageId: string }) => {
      if (!this.scanned) return;
      await this.read(pageId);
      this.notify();
    };
    this.offs.push(
      input.events.on('doc.changed', (event) => void changed(event)),
      input.events.on('page.deleted', ({ pageId }) => {
        this.sources.delete(pageId);
        this.notify();
      }),
      input.events.on('page.trashed', () => this.notify()),
      input.events.on('page.restored', () => this.notify()),
      input.events.on('page.renamed', () => this.notify()),
    );
  }

  async backlinks(pageId: string): Promise<Backlink[]> {
    await this.scan();
    const snapshot = this.input.pages.getSnapshot();
    const result: Backlink[] = [];
    for (const [sourcePageId, source] of this.sources) {
      if (
        sourcePageId === pageId ||
        snapshot.isTrashed(sourcePageId) ||
        !snapshot.has(sourcePageId)
      )
        continue;
      for (const link of source.links) {
        if (link.targetPageId !== pageId) continue;
        result.push({
          sourcePageId,
          targetPageId: pageId,
          label: link.label,
          heading: link.heading,
          blockRef: link.blockRef,
          blockText: link.blockText,
          path: link.path,
          offset: link.offset,
          blockId: link.blockId,
        });
      }
    }
    return this.sortBySource(result);
  }

  async outgoing(pageId: string): Promise<ExtractedLink[]> {
    await this.scan();
    return this.sources.get(pageId)?.links ?? [];
  }

  async unlinkedMentions(pageId: string): Promise<UnlinkedMention[]> {
    await this.scan();
    const snapshot = this.input.pages.getSnapshot();
    const page = snapshot.get(pageId);
    if (!page) return [];
    const needles = [page.title, ...(this.sources.get(pageId)?.aliases ?? [])].filter(
      (n) => n.trim().length > 1,
    );
    if (!needles.length) return [];
    const result: UnlinkedMention[] = [];
    for (const [sourcePageId, source] of this.sources) {
      if (
        sourcePageId === pageId ||
        snapshot.isTrashed(sourcePageId) ||
        !snapshot.has(sourcePageId)
      )
        continue;
      for (const hit of findTextOccurrences(source.doc, needles)) {
        result.push({ sourcePageId, targetPageId: pageId, ...hit });
      }
    }
    return this.sortBySource(result);
  }

  /** Deterministic order: source page title, then position in the source. */
  private sortBySource<T extends { sourcePageId: string; path: number[] }>(items: T[]): T[] {
    const snapshot = this.input.pages.getSnapshot();
    const title = (id: string) => snapshot.get(id)?.title ?? '';
    return items
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          title(a.item.sourcePageId).localeCompare(title(b.item.sourcePageId)) ||
          a.item.sourcePageId.localeCompare(b.item.sourcePageId) ||
          a.index - b.index,
      )
      .map(({ item }) => item);
  }

  async edges(): Promise<LinkEdge[]> {
    await this.scan();
    const snapshot = this.input.pages.getSnapshot();
    const counts = new Map<string, LinkEdge>();
    for (const [source, entry] of this.sources) {
      if (snapshot.isTrashed(source) || !snapshot.has(source)) continue;
      for (const link of entry.links) {
        if (!snapshot.has(link.targetPageId) || link.targetPageId === source) continue;
        const key = `${source}\u0000${link.targetPageId}`;
        const edge = counts.get(key);
        if (edge) edge.count += 1;
        else counts.set(key, { source, target: link.targetPageId, count: 1 });
      }
    }
    return [...counts.values()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.listeners.clear();
  }

  private async scan(): Promise<void> {
    if (this.scanned) return;
    for (const page of this.input.pages.getSnapshot().all()) {
      if (page.kind === 'page' && !this.sources.has(page.id)) await this.read(page.id);
    }
    this.scanned = true;
  }

  private async read(pageId: string): Promise<void> {
    const page = this.input.pages.getSnapshot().get(pageId);
    if (!page || page.kind !== 'page') {
      this.sources.delete(pageId);
      return;
    }
    const handle = await this.input.loadPageDoc(pageId);
    try {
      const doc = readDocJSON(handle.doc);
      this.sources.set(pageId, {
        doc,
        links: extractLinks(doc),
        aliases: getPageProps(handle.doc).aliases ?? [],
      });
    } finally {
      handle.release();
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
