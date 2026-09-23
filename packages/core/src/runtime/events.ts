import type { PageMeta, PageMetaField } from '../model/page-meta';
import type { WorkspaceInfo } from '../services/workspace-registry';
import type { CurrentUser } from './user';

/**
 * Every event on the {@link EventBus}, with its payload. Page events fire for local *and* remote
 * changes (synced edits, other tabs), because the runtime derives them from the workspace doc.
 * `local` tells them apart.
 */
export interface TesseraEvents {
  /** A workspace session is ready (services resolved, features activated). */
  'workspace.opened': { workspace: WorkspaceInfo };
  /** A workspace session is closing. Flush anything you keep in memory. */
  'workspace.closed': { workspaceId: string };
  'page.created': { page: PageMeta; local: boolean };
  'page.renamed': { pageId: string; title: string; previousTitle: string; local: boolean };
  'page.moved': {
    pageId: string;
    parentId: string | null;
    previousParentId: string | null;
    local: boolean;
  };
  /** Any metadata change (also fires alongside renamed/moved/trashed/restored). */
  'page.updated': { page: PageMeta; previous: PageMeta; fields: PageMetaField[]; local: boolean };
  /** A page went to the trash. `affectedPageIds` = the page and every descendant that became trashed. */
  'page.trashed': { pageId: string; affectedPageIds: string[]; local: boolean };
  /** A page came back. `affectedPageIds` = the page and every descendant that is visible again. */
  'page.restored': { pageId: string; affectedPageIds: string[]; local: boolean };
  /** A page was deleted permanently (fires once per removed page, subtree included). */
  'page.deleted': { pageId: string; page: PageMeta; local: boolean };
  /** A loaded page doc's content or props changed (debounced per page, ~750 ms, max wait 3 s). */
  'doc.changed': { pageId: string; docName: string; local: boolean };
  /** A loaded database doc changed (debounced like `doc.changed`). Use `observeDatabase` for details. */
  'database.changed': { databaseId: string; docName: string; local: boolean };
  'settings.changed': { scope: 'device' | 'workspace'; key: string };
  /** The current user's name or color changed. */
  'user.changed': { user: CurrentUser };
  /** The shell navigated (page view or another route). */
  'navigation.changed': { pageId: string | null; path: string };
}

export type TesseraEventName = keyof TesseraEvents;

/**
 * A typed, synchronous event bus. A throwing handler is logged and never stops other handlers.
 *
 * @example
 * const off = ctx.events.on('page.renamed', ({ pageId, title }) => index.updateTitle(pageId, title));
 * // later: off();
 */
export interface EventBus<E extends object = TesseraEvents> {
  on<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void;
  once<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
  /** Number of handlers for a type (for tests and diagnostics). */
  listenerCount(type: keyof E): number;
  /** Removes every handler. */
  clear(): void;
}

/** Creates an {@link EventBus}. */
export function createEventBus<E extends object = TesseraEvents>(
  options: { onError?: (error: unknown, type: keyof E) => void } = {},
): EventBus<E> {
  const handlers = new Map<keyof E, Set<(payload: never) => void>>();
  const report =
    options.onError ??
    ((error: unknown, type: keyof E) =>
      console.error(`[events] "${String(type)}" handler failed`, error));

  const bus: EventBus<E> = {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as (payload: never) => void);
      return () => {
        set.delete(handler as (payload: never) => void);
      };
    },
    once(type, handler) {
      const off = bus.on(type, (payload) => {
        off();
        handler(payload);
      });
      return off;
    },
    emit(type, payload) {
      for (const handler of [...(handlers.get(type) ?? [])]) {
        try {
          (handler as (value: typeof payload) => void)(payload);
        } catch (error) {
          report(error, type);
        }
      }
    },
    listenerCount(type) {
      return handlers.get(type)?.size ?? 0;
    },
    clear() {
      handlers.clear();
    },
  };
  return bus;
}
