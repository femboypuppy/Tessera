import type * as Y from 'yjs';
import { jsonEqual, type JsonValue } from '../json';
import type { PageMeta, PageMetaField } from './page-meta';
import { PAGE_META_FIELDS } from './page-meta';
import { readPageMeta } from './pages';
import { pagesMapOf } from './workspace-doc';

/** One updated page in a {@link PagesChange}. */
export interface PageUpdate {
  page: PageMeta;
  previous: PageMeta;
  /** Fields whose value changed. */
  fields: PageMetaField[];
}

/** Everything that changed in the page tree in one Yjs transaction. */
export interface PagesChange {
  added: PageMeta[];
  updated: PageUpdate[];
  /** Removed pages, with their last known metadata. */
  removed: PageMeta[];
  /** True when the change was made in this process (false for sync, other tabs and storage loads). */
  local: boolean;
  /** The transaction origin. */
  origin: unknown;
}

function changedFields(a: PageMeta, b: PageMeta): PageMetaField[] {
  return PAGE_META_FIELDS.filter(
    (field) => !jsonEqual(a[field] as JsonValue | undefined, b[field] as JsonValue | undefined),
  );
}

/**
 * Observes the page tree. The listener runs once per transaction that added, updated or removed
 * pages, whether the change was local, synced from a server, or loaded from storage.
 * The shell turns these into `page.*` events on the `EventBus`, so most features subscribe
 * there instead.
 *
 * @example
 * const stop = observePages(wsDoc, ({ added, updated, removed }) => {
 *   for (const { page, fields } of updated) if (fields.includes('title')) reindex(page.id);
 * });
 */
export function observePages(ws: Y.Doc, listener: (change: PagesChange) => void): () => void {
  const pages = pagesMapOf(ws);
  const cache = new Map<string, PageMeta>();
  pages.forEach((value, id) => {
    const meta = readPageMeta(id, value);
    if (meta) cache.set(id, meta);
  });

  const handler = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
    transaction: Y.Transaction,
  ) => {
    const touched = new Set<string>();
    for (const event of events) {
      if (event.target === pages) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) touched.add(key);
      } else {
        const first = event.path[0];
        if (typeof first === 'string') touched.add(first);
      }
    }
    if (touched.size === 0) return;
    const change: PagesChange = {
      added: [],
      updated: [],
      removed: [],
      local: transaction.local,
      origin: transaction.origin,
    };
    for (const id of touched) {
      const previous = cache.get(id);
      const current = readPageMeta(id, pages.get(id));
      if (current && !previous) {
        change.added.push(current);
        cache.set(id, current);
      } else if (!current && previous) {
        change.removed.push(previous);
        cache.delete(id);
      } else if (current && previous) {
        const fields = changedFields(previous, current);
        if (fields.length > 0) {
          change.updated.push({ page: current, previous, fields });
          cache.set(id, current);
        }
      }
    }
    if (change.added.length || change.updated.length || change.removed.length) listener(change);
  };

  pages.observeDeep(handler);
  return () => pages.unobserveDeep(handler);
}
