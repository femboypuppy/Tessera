import type { AppContext, ResolvedRow, ViewConfig } from '@tessera/core';
import { useAppContext, useDatabaseDoc, usePages } from '@tessera/core/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { acquireDatabaseStore, type DatabaseSnapshot, type DatabaseStore } from '../model/store';
import type { DatabaseRef } from '../model/operations';
import { createQueryContext, type QueryContext } from '../query/types';
import { runQuery, type QueryResult } from '../query/run';
import type { SearchCache } from '../query/search';
import { displayLocale, errorMessage } from './common';

/** What {@link useDatabase} returns. */
export interface DatabaseState {
  /** The database page ID and its doc, once loaded. */
  ref: DatabaseRef | null;
  snapshot: DatabaseSnapshot | null;
  loading: boolean;
  error: Error | null;
}

const noSubscribe = () => () => undefined;
const noSnapshot = () => null;

/**
 * Opens a database doc and follows it through a shared {@link DatabaseStore}, so every view of
 * the same database renders from one snapshot. The lease is released on unmount.
 */
export function useDatabase(databaseId: string | null | undefined): DatabaseState {
  const ctx = useAppContext();
  const { handle, loaded, error } = useDatabaseDoc(databaseId);
  const [store, setStore] = useState<DatabaseStore | null>(null);
  useEffect(() => {
    if (!handle || !loaded) {
      setStore(null);
      return undefined;
    }
    const entry = acquireDatabaseStore(handle.doc, ctx.workspace.pages);
    setStore(entry.store);
    return () => {
      entry.release();
    };
  }, [handle, loaded, ctx]);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? noSnapshot,
    store?.getSnapshot ?? noSnapshot,
  );
  const ref = useMemo(
    () => (store && databaseId ? { id: databaseId, doc: store.doc } : null),
    [store, databaseId],
  );
  return {
    ref,
    snapshot: store ? snapshot : null,
    loading: !error && (!loaded || !store),
    error,
  };
}

/** Epoch ms that changes at every local midnight (relative dates and "Today" stay right). */
export function useToday(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 1, 0);
    const timer = window.setTimeout(() => setNow(Date.now()), midnight.getTime() - Date.now());
    return () => window.clearTimeout(timer);
  }, [now]);
  return now;
}

/**
 * The query context of the viewer: clock (refreshed at midnight), time zone, display locale,
 * week start, and page titles and visibility from the live page index (relations).
 */
export function useQueryContext(weekStartsOn: 0 | 1 = 1): QueryContext {
  const pages = usePages();
  const now = useToday();
  return useMemo(
    () =>
      createQueryContext({
        now,
        locale: displayLocale(),
        weekStartsOn,
        titleOf: (id) => pages.get(id)?.title,
        isPageVisible: (id) => pages.has(id) && !pages.isTrashed(id),
      }),
    [pages, now, weekStartsOn],
  );
}

/** One search cache per schema: row objects are stable, so repeated searches reuse their text. */
const searchCaches = new WeakMap<object, SearchCache>();

function searchCacheFor(properties: object): SearchCache {
  let cache = searchCaches.get(properties);
  if (!cache) {
    cache = new WeakMap();
    searchCaches.set(properties, cache);
  }
  return cache;
}

/** Runs a view's query, memoized on everything that changes its result. */
export function useViewQuery(
  snapshot: DatabaseSnapshot,
  view: Pick<ViewConfig, 'filter' | 'sorts' | 'group'>,
  search: string,
  queryCtx: QueryContext,
  options: { group?: boolean } = {},
): QueryResult<ResolvedRow> {
  const { rows, properties } = snapshot;
  const { filter, sorts, group } = view;
  const grouped = options.group ?? true;
  return useMemo(
    () =>
      runQuery(rows, properties, { filter, sorts, group }, queryCtx, {
        search,
        searchCache: searchCacheFor(properties),
        group: grouped,
      }),
    [rows, properties, filter, sorts, group, search, queryCtx, grouped],
  );
}

/**
 * Wraps database actions so a failure becomes an error toast instead of an exception in React.
 *
 * @example
 * const act = useAction();
 * <Button onClick={() => act(() => addRow(ctx, ref))} />
 */
export function useAction(): (action: () => unknown) => void {
  const ctx = useAppContext();
  return useCallback((action: () => unknown) => runAction(ctx, action), [ctx]);
}

/** {@link useAction} outside React. */
export function runAction(ctx: Pick<AppContext, 'toast'>, action: () => unknown): void {
  const report = (error: unknown) =>
    ctx.toast({ variant: 'error', title: t('actionFailed'), description: errorMessage(error) });
  try {
    const result = action();
    if (result instanceof Promise) result.catch(report);
  } catch (error) {
    report(error);
  }
}

/**
 * Runs an action after a Radix menu has fully closed. Menus move focus while they animate out, so
 * anything that focuses a new field (rename inputs) must wait: schedule it from the item, and pass
 * `onCloseAutoFocus` to the menu content.
 *
 * @example
 * const after = useAfterMenuClose();
 * <DropdownMenuItem onSelect={() => after.schedule(() => setRenaming(id))} />
 * <DropdownMenuContent onCloseAutoFocus={after.onCloseAutoFocus} />
 */
export function useAfterMenuClose(): {
  schedule: (action: () => void) => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const pending = useRef<(() => void) | null>(null);
  return useMemo(
    () => ({
      schedule: (action: () => void) => {
        pending.current = action;
      },
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        const action = pending.current;
        pending.current = null;
        action?.();
      },
    }),
    [],
  );
}
