import { compareOrdered } from '../order';
import type { PageMeta } from './page-meta';

/** A node of the page tree (see {@link PageIndex.tree}). */
export interface PageTreeNode {
  page: PageMeta;
  /** 0 for top-level pages. */
  depth: number;
  children: PageTreeNode[];
}

/** Options for tree and child queries. */
export interface PageQueryOptions {
  /** Include pages that are in the trash (themselves or through an ancestor). Default false. */
  includeTrashed?: boolean;
  /** Include database rows (children of database pages). Default false. */
  includeRows?: boolean;
}

/**
 * An immutable, query-optimized view of every page in a workspace. Build one with
 * {@link createPageIndex}; the React store and the shell keep one per workspace change.
 *
 * It is robust against states that concurrent edits can produce:
 * - a page whose parent no longer exists is treated as top-level (never lost);
 * - pages whose parents form a cycle are broken deterministically (the member with the smallest
 *   ID becomes top-level), so every client shows the same tree.
 *
 * @example
 * const index = createPageIndex(listPages(wsDoc));
 * index.children(null); // sorted top-level pages, trash and rows excluded
 * index.ancestors(pageId); // breadcrumbs, root first
 */
export interface PageIndex {
  readonly size: number;
  get(id: string): PageMeta | undefined;
  has(id: string): boolean;
  /** Every page, including trashed pages and rows, in no particular order. */
  all(): readonly PageMeta[];
  /** The parent used for display: null for top-level pages, orphans and broken cycles. */
  effectiveParentId(id: string): string | null;
  /** Sorted children of `parentId` (null = top level). */
  children(parentId: string | null, options?: PageQueryOptions): readonly PageMeta[];
  /** Ancestors of `id`, root first, excluding `id` itself. */
  ancestors(id: string): readonly PageMeta[];
  /** Every descendant of `id` in depth-first pre-order (rows and trashed pages included by default). */
  descendants(id: string, options?: PageQueryOptions): readonly PageMeta[];
  /** True when the page or one of its ancestors is in the trash. */
  isTrashed(id: string): boolean;
  /** True when the page is a database row (its effective parent is a database page). */
  isRow(id: string): boolean;
  /** Pages that were trashed themselves (not through an ancestor), newest first. */
  trash(): readonly PageMeta[];
  /** Favorite pages that are not in the trash, sorted by title. */
  favorites(): readonly PageMeta[];
  /** The page tree (trash and rows excluded by default). */
  tree(options?: PageQueryOptions): readonly PageTreeNode[];
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Builds a {@link PageIndex} from page metadata. O(n); derived lists are computed lazily. */
export function createPageIndex(pages: Iterable<PageMeta>): PageIndex {
  const byId = new Map<string, PageMeta>();
  for (const page of pages) byId.set(page.id, page);

  // Effective parents: resolve orphans and break cycles deterministically.
  const effective = new Map<string, string | null>();
  for (const start of byId.keys()) {
    if (effective.has(start)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let current: string | null = start;
    while (current !== null && !effective.has(current)) {
      const seenAt = onPath.get(current);
      if (seenAt !== undefined) {
        const cycle = path.slice(seenAt);
        const root = cycle.reduce((min, id) => (id < min ? id : min));
        effective.set(root, null);
        break;
      }
      onPath.set(current, path.length);
      path.push(current);
      const page = byId.get(current);
      const parentId: string | null = page?.parentId ?? null;
      if (parentId === null || !byId.has(parentId)) {
        effective.set(current, null);
        break;
      }
      current = parentId;
    }
    for (const id of path) {
      if (!effective.has(id)) effective.set(id, byId.get(id)?.parentId ?? null);
    }
  }

  const childIds = new Map<string | null, string[]>();
  for (const [id, parentId] of effective) {
    const list = childIds.get(parentId);
    if (list) list.push(id);
    else childIds.set(parentId, [id]);
  }

  const sortedChildren = new Map<string | null, PageMeta[]>();
  const allChildrenOf = (parentId: string | null): PageMeta[] => {
    let list = sortedChildren.get(parentId);
    if (!list) {
      list = (childIds.get(parentId) ?? [])
        .map((id) => byId.get(id))
        .filter((page): page is PageMeta => page !== undefined)
        .sort(compareOrdered);
      sortedChildren.set(parentId, list);
    }
    return list;
  };

  const trashedMemo = new Map<string, boolean>();
  const isTrashed = (id: string): boolean => {
    const cached = trashedMemo.get(id);
    if (cached !== undefined) return cached;
    const chain: string[] = [];
    let current: string | null = id;
    let result = false;
    while (current !== null) {
      const memo = trashedMemo.get(current);
      if (memo !== undefined) {
        result = memo;
        break;
      }
      const page = byId.get(current);
      if (!page) break;
      chain.push(current);
      if (page.trashedAt !== undefined) {
        result = true;
        break;
      }
      current = effective.get(current) ?? null;
    }
    for (const member of chain) trashedMemo.set(member, result);
    return result;
  };

  const isRow = (id: string): boolean => {
    const parentId = effective.get(id) ?? null;
    return parentId !== null && byId.get(parentId)?.kind === 'database';
  };

  const visible = (page: PageMeta, options: PageQueryOptions | undefined): boolean => {
    if (!options?.includeTrashed && page.trashedAt !== undefined) return false;
    if (!options?.includeRows && isRow(page.id)) return false;
    return true;
  };

  const children = (parentId: string | null, options?: PageQueryOptions): readonly PageMeta[] => {
    if (parentId !== null && !options?.includeTrashed && isTrashed(parentId)) return [];
    return allChildrenOf(parentId).filter((page) => visible(page, options));
  };

  const ancestors = (id: string): readonly PageMeta[] => {
    const result: PageMeta[] = [];
    let current = effective.get(id) ?? null;
    const seen = new Set<string>([id]);
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const page = byId.get(current);
      if (!page) break;
      result.push(page);
      current = effective.get(current) ?? null;
    }
    return result.reverse();
  };

  const descendants = (id: string, options?: PageQueryOptions): readonly PageMeta[] => {
    const opts = { includeTrashed: true, includeRows: true, ...options };
    const result: PageMeta[] = [];
    const stack = [...children(id, opts)].reverse();
    const seen = new Set<string>([id]);
    while (stack.length > 0) {
      const page = stack.pop();
      if (!page || seen.has(page.id)) continue;
      seen.add(page.id);
      result.push(page);
      const kids = children(page.id, opts);
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const kid = kids[i];
        if (kid) stack.push(kid);
      }
    }
    return result;
  };

  let trashList: PageMeta[] | undefined;
  let favoriteList: PageMeta[] | undefined;
  const treeCache = new Map<string, PageTreeNode[]>();

  const buildTree = (options?: PageQueryOptions): PageTreeNode[] => {
    const key = `${options?.includeTrashed ? 1 : 0}${options?.includeRows ? 1 : 0}`;
    const cached = treeCache.get(key);
    if (cached) return cached;
    const build = (parentId: string | null, depth: number, seen: Set<string>): PageTreeNode[] =>
      children(parentId, options)
        .filter((page) => !seen.has(page.id))
        .map((page) => {
          seen.add(page.id);
          return { page, depth, children: build(page.id, depth + 1, seen) };
        });
    const tree = build(null, 0, new Set());
    treeCache.set(key, tree);
    return tree;
  };

  const allPages = [...byId.values()];

  return {
    size: byId.size,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    all: () => allPages,
    effectiveParentId: (id) => effective.get(id) ?? null,
    children,
    ancestors,
    descendants,
    isTrashed,
    isRow,
    trash: () => {
      trashList ??= allPages
        .filter((page) => page.trashedAt !== undefined)
        .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0) || compareOrdered(a, b));
      return trashList;
    },
    favorites: () => {
      favoriteList ??= allPages
        .filter((page) => page.favorite === true && !isTrashed(page.id))
        .sort((a, b) => collator.compare(a.title, b.title) || compareOrdered(a, b));
      return favoriteList;
    },
    tree: buildTree,
  };
}

/** Flattens a page tree into depth-first order (useful for virtualized sidebars and exports). */
export function flattenPageTree(tree: readonly PageTreeNode[]): PageTreeNode[] {
  const result: PageTreeNode[] = [];
  const visit = (nodes: readonly PageTreeNode[]) => {
    for (const node of nodes) {
      result.push(node);
      visit(node.children);
    }
  };
  visit(tree);
  return result;
}
