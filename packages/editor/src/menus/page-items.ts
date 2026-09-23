import type { PageIndex, PageMeta } from '@tessera/core';
import { FilePlus, FileText } from 'lucide-react';
import { t } from '../i18n';
import { foldText, fuzzyScore, pushRecent } from './fuzzy';
import type { MenuItem } from './types';

/** Device setting with recently visited or linked pages (most recent first). */
export const RECENT_PAGES_KEY = 'editor.recentPages';

/** A row of the page autocomplete: an existing page, or "Create page 'X'". */
export type PageMenuItem = MenuItem &
  ({ kind: 'page'; pageId: string } | { kind: 'create'; newTitle: string });

const MAX_RESULTS = 12;

/** "in Parent / Child" for a page with ancestors. */
function breadcrumb(index: PageIndex, page: PageMeta): string | undefined {
  const ancestors = index.ancestors(page.id);
  if (!ancestors.length) return undefined;
  const path = ancestors
    .slice(-2)
    .map((ancestor) => ancestor.title || t('untitled'))
    .join(' / ');
  return t('inPage', { title: ancestors.length > 2 ? `… / ${path}` : path });
}

/**
 * Page suggestions for `[[` and `@`: fuzzy over titles, trashed pages left out. With an empty
 * query, recently visited pages come first, then recently edited ones. A query that doesn't match
 * a title exactly ends with "Create page 'query'".
 */
export function pageSuggestions(
  index: PageIndex,
  query: string,
  recent: readonly string[],
  currentPageId: string | null,
): PageMenuItem[] {
  const trimmed = query.trim();
  const recency = (page: PageMeta) => {
    const position = recent.indexOf(page.id);
    return position < 0 ? Number.POSITIVE_INFINITY : position;
  };
  const candidates = index.all().filter((page) => !index.isTrashed(page.id));
  let ranked: PageMeta[];
  if (!trimmed) {
    ranked = [...candidates].sort(
      (a, b) =>
        recency(a) - recency(b) ||
        Number(a.id === currentPageId) - Number(b.id === currentPageId) ||
        b.updatedAt - a.updatedAt,
    );
  } else {
    ranked = candidates
      .map((page) => ({ page, score: fuzzyScore(trimmed, page.title || t('untitled')) }))
      .filter((entry): entry is { page: PageMeta; score: number } => entry.score !== null)
      .sort(
        (a, b) =>
          b.score - a.score ||
          recency(a.page) - recency(b.page) ||
          b.page.updatedAt - a.page.updatedAt,
      )
      .map((entry) => entry.page);
  }
  const items: PageMenuItem[] = ranked.slice(0, MAX_RESULTS).map((page) => ({
    kind: 'page',
    id: `page:${page.id}`,
    pageId: page.id,
    title: page.title || t('untitled'),
    icon: page.icon ?? FileText,
    description: breadcrumb(index, page),
  }));
  const exact = candidates.some((page) => foldText(page.title) === foldText(trimmed));
  if (trimmed && !exact) {
    const newTitle = trimmed.slice(0, 200);
    items.push({
      kind: 'create',
      id: 'create',
      newTitle,
      title: t('createPage', { title: newTitle }),
      icon: FilePlus,
    });
  }
  return items;
}

/** Adds a page to the recent pages list. */
export function withRecentPage(list: readonly string[], pageId: string): string[] {
  return pushRecent(list, pageId, 20);
}

/** Reads the recent pages list from a settings value. */
export function readRecentPages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').slice(0, 20)
    : [];
}
