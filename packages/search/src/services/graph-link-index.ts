import type { LinkEdge, LinkIndex, UnlinkedMention } from '@tessera/core';
import type {
  GraphSnapshot,
  RichBacklink,
  RichOutgoingLink,
  TagCount,
  TagPair,
} from '../engine/types';
import type { IndexHost } from './index-host';

/**
 * The graph {@link LinkIndex} (priority 50): outgoing links, backlinks with the text of their
 * block, unlinked mentions (title and aliases, whole words, case-insensitive), orphans, tag
 * co-occurrence, and the snapshots the graph views render. It shares the index worker with
 * `MiniSearchIndex`, so each doc is read once for both.
 *
 * @example
 * const backlinks = await ctx.services.linkIndex.backlinks(pageId);
 */
export class GraphLinkIndex implements LinkIndex {
  constructor(readonly host: IndexHost) {}

  backlinks(pageId: string): Promise<RichBacklink[]> {
    return this.host.backlinks(pageId);
  }

  outgoing(pageId: string): Promise<RichOutgoingLink[]> {
    return this.host.outgoing(pageId);
  }

  unlinkedMentions(pageId: string): Promise<UnlinkedMention[]> {
    return this.host.unlinkedMentions(pageId);
  }

  edges(): Promise<LinkEdge[]> {
    return this.host.edges();
  }

  /** Pages with no links in or out (rows and trashed pages excluded). */
  orphans(): Promise<string[]> {
    return this.host.orphans();
  }

  tags(): Promise<TagCount[]> {
    return this.host.tags();
  }

  tagCooccurrence(): Promise<TagPair[]> {
    return this.host.tagCooccurrence();
  }

  /** Every page not in the trash, with tags and top-level parents, and the edges between them. */
  graph(): Promise<GraphSnapshot> {
    return this.host.graph();
  }

  /** The pages within `depth` links of a page. */
  neighborhood(pageId: string, depth: number): Promise<GraphSnapshot> {
    return this.host.neighborhood(pageId, depth);
  }

  whenIdle(): Promise<void> {
    return this.host.whenIdle();
  }

  subscribe(listener: () => void): () => void {
    return this.host.subscribe((change) => {
      if (change.links) listener();
    });
  }

  dispose(): Promise<void> {
    return this.host.release();
  }
}
