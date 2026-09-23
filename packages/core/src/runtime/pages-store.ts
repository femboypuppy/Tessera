import type * as Y from 'yjs';
import { observePages, type PagesChange } from '../model/observe-pages';
import { createPageIndex, type PageIndex } from '../model/page-index';
import type { PageMeta } from '../model/page-meta';
import { listPages } from '../model/pages';

/** An immutable snapshot of every page, with fast queries (see {@link PageIndex}). */
export interface PagesSnapshot extends PageIndex {
  /** Increments on every change; handy as a memo key. */
  readonly version: number;
}

/**
 * A subscribable store of the workspace's pages, compatible with React's `useSyncExternalStore`.
 * `AppContext.workspace.pages` is one; `usePages()` in `@tessera/core/react` reads it.
 *
 * @example
 * const snapshot = ctx.workspace.pages.getSnapshot();
 * snapshot.children(null).map((page) => page.title);
 */
export interface PagesStore {
  getSnapshot(): PagesSnapshot;
  subscribe(listener: () => void): () => void;
}

/** Creates a {@link PagesStore} that follows a workspace doc. Call `dispose` when done. */
export function createPagesStore(
  ws: Y.Doc,
  options: { onChange?: (change: PagesChange) => void } = {},
): PagesStore & { dispose(): void } {
  const pages = new Map<string, PageMeta>(listPages(ws).map((page) => [page.id, page]));
  const listeners = new Set<() => void>();
  let version = 0;
  const build = (): PagesSnapshot => ({ ...createPageIndex(pages.values()), version });
  let snapshot = build();

  const stop = observePages(ws, (change) => {
    for (const page of change.added) pages.set(page.id, page);
    for (const { page } of change.updated) pages.set(page.id, page);
    for (const page of change.removed) pages.delete(page.id);
    version += 1;
    snapshot = build();
    options.onChange?.(change);
    for (const listener of [...listeners]) listener();
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stop();
      listeners.clear();
    },
  };
}
