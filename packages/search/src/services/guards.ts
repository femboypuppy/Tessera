import type { LinkIndex, SearchIndex } from '@tessera/core';
import type { GraphLinkIndex } from './graph-link-index';
import type { MiniSearchIndex } from './minisearch-index';

// Duck-typed on purpose: UI modules check which implementation won without importing it (which
// would pull MiniSearch into their chunks).

/** True when the resolved search index is `MiniSearchIndex` (tags, status, rich hits). */
export function isMiniSearchIndex(index: SearchIndex): index is MiniSearchIndex {
  const candidate = index as Partial<MiniSearchIndex>;
  return (
    typeof candidate.tags === 'function' &&
    typeof candidate.whenIdle === 'function' &&
    typeof candidate.subscribeStatus === 'function'
  );
}

/** True when the resolved link index is `GraphLinkIndex` (graph snapshots, orphans, tags). */
export function isGraphLinkIndex(index: LinkIndex): index is GraphLinkIndex {
  const candidate = index as Partial<GraphLinkIndex>;
  return typeof candidate.graph === 'function' && typeof candidate.neighborhood === 'function';
}
