/**
 * @tessera/search — search index, command palette, backlinks and graph (Agent 05).
 *
 * Everything is exported from subpaths, so features load only what they need:
 *
 * - `@tessera/search/services`: `MiniSearchIndex` (SearchIndex) and `GraphLinkIndex` (LinkIndex),
 *   one index worker per workspace session (heavy: load with `import()`);
 * - `@tessera/search/palette-host`: the palette overlay host, its store, recent pages and
 *   `openSearch` (light, part of the startup bundle);
 * - `@tessera/search/search-page`: the `/search` route;
 * - `@tessera/search/backlinks`: the backlinks panel, footer and settings (lazy);
 * - `@tessera/search/graph`: the `/graph` route and the local graph panel (lazy);
 * - `@tessera/search/i18n`: `t()` for the `search` namespace;
 * - `@tessera/search/test-hooks`: e2e and screenshot seeding (only when enabled).
 *
 * See HANDOFF/search.md.
 */
export const SEARCH_PACKAGE = '@tessera/search';

export type { ParsedQuery } from './engine/query';
export type {
  GraphNode,
  GraphSnapshot,
  RichBacklink,
  RichOutgoingLink,
  RichSearchHit,
  Segment,
  TagCount,
  TagPair,
} from './engine/types';
