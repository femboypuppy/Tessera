import type { AppContext } from '@tessera/core';
import { useSyncExternalStore } from 'react';

/** What the `/search` route shows (kept in the URL: `/search?q=…&page=2&rows=0`). */
export interface SearchParams {
  query: string;
  page: number;
  includeRows: boolean;
}

export const SEARCH_PATH = '/search';

/** Reads search params from a `location.search` string. */
export function parseSearchParams(search: string): SearchParams {
  const params = new URLSearchParams(search);
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    query: params.get('q') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    includeRows: params.get('rows') !== '0',
  };
}

/** The `/search` URL for some params. */
export function searchUrl(params: Partial<SearchParams>): string {
  const query = new URLSearchParams();
  if (params.query) query.set('q', params.query);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  if (params.includeRows === false) query.set('rows', '0');
  const text = query.toString();
  return text ? `${SEARCH_PATH}?${text}` : SEARCH_PATH;
}

// The search page follows this store instead of the router, so the package needs no router of
// its own: every navigation to /search goes through `openSearch`, and back/forward through
// `popstate`.
let current: SearchParams = parseSearchParams(
  typeof window === 'undefined' ? '' : window.location.search,
);
const listeners = new Set<() => void>();

function set(next: SearchParams): void {
  if (
    next.query === current.query &&
    next.page === current.page &&
    next.includeRows === current.includeRows
  )
    return;
  current = next;
  for (const listener of [...listeners]) listener();
}

const onPopState = () => set(parseSearchParams(window.location.search));

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('popstate', onPopState);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', onPopState);
  };
}

/** Syncs the store with the address bar (call when the search page mounts). */
export function syncSearchParamsFromLocation(): void {
  if (typeof window !== 'undefined') set(parseSearchParams(window.location.search));
}

/** The search page's params, re-rendering on changes. */
export function useSearchParamsState(): SearchParams {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** Opens (or updates) the search page. */
export function openSearch(
  ctx: Pick<AppContext, 'navigateTo'>,
  params: Partial<SearchParams>,
  options: { replace?: boolean } = {},
): void {
  const next: SearchParams = {
    query: params.query ?? '',
    page: params.page ?? 1,
    includeRows: params.includeRows ?? true,
  };
  set(next);
  ctx.navigateTo(searchUrl(next), options);
}
