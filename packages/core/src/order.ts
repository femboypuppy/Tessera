import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { NotFoundError } from './errors';

/** Anything that is ordered among its siblings by a fractional index. */
export interface Ordered {
  readonly id: string;
  readonly order: string;
}

/**
 * Sort comparator for ordered items: by `order` (plain code-unit comparison, as fractional
 * indexes require), then by `id` so concurrent inserts with equal keys still sort
 * deterministically on every client.
 *
 * @example
 * siblings.sort(compareOrdered);
 */
export function compareOrdered(a: Ordered, b: Ordered): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Returns a sorted copy of `items` using {@link compareOrdered}. */
export function sortOrdered<T extends Ordered>(items: Iterable<T>): T[] {
  return [...items].sort(compareOrdered);
}

/** Returns true when `key` is a valid fractional index. */
export function isValidOrderKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns an order key strictly between `before` and `after` (either may be null for the
 * start or the end). Throws when `before >= after` or a key is malformed; use
 * {@link orderForIndex} when the neighbours might be tied.
 *
 * @example
 * orderBetween(null, null); // 'a0'
 * orderBetween('a0', 'a1'); // 'a0V'
 */
export function orderBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`Cannot generate an order key between "${before}" and "${after}"`);
  }
  return generateKeyBetween(before, after);
}

/** Returns `count` ascending order keys between `before` and `after`. */
export function ordersBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (count <= 0) return [];
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`Cannot generate order keys between "${before}" and "${after}"`);
  }
  return generateNKeysBetween(before, after, count);
}

/** Result of {@link orderForIndex}. */
export interface OrderForIndexResult {
  /** The key for the inserted or moved item. */
  order: string;
  /**
   * Siblings that must be re-keyed in the same transaction. Empty unless the neighbours were
   * tied or malformed (which only happens after concurrent inserts or corruption).
   */
  rekeyed: Array<{ id: string; order: string }>;
}

/**
 * Computes the order key for placing an item at `index` among `siblings`, which must already be
 * sorted with {@link compareOrdered} and must not contain the item itself. When the neighbours are
 * tied or malformed, every sibling is re-keyed so the result is always exact.
 *
 * @example
 * const { order, rekeyed } = orderForIndex(sortedSiblings, 2);
 */
export function orderForIndex(siblings: readonly Ordered[], index: number): OrderForIndexResult {
  const i = Math.max(
    0,
    Math.min(Math.trunc(Number.isFinite(index) ? index : siblings.length), siblings.length),
  );
  const before = siblings[i - 1]?.order ?? null;
  const after = siblings[i]?.order ?? null;
  try {
    return { order: orderBetween(before, after), rekeyed: [] };
  } catch {
    const keys = generateNKeysBetween(null, null, siblings.length + 1);
    const rekeyed: Array<{ id: string; order: string }> = [];
    let key = 0;
    for (const sibling of siblings) {
      if (key === i) key += 1;
      const order = keys[key];
      if (order === undefined) break;
      rekeyed.push({ id: sibling.id, order });
      key += 1;
    }
    const order = keys[i];
    if (order === undefined) throw new RangeError('Failed to generate order keys');
    return { order, rekeyed };
  }
}

/** Returns a key that sorts after every item in `siblings` (sorted or not). */
export function orderAfterAll(siblings: Iterable<Ordered>): string {
  let last: string | null = null;
  for (const sibling of siblings) {
    if (isValidOrderKey(sibling.order) && (last === null || sibling.order > last))
      last = sibling.order;
  }
  return generateKeyBetween(last, null);
}

/**
 * Where to put an item among its siblings: at the start or end, at an index, or directly before or
 * after a sibling (by ID). Used by pages, properties, options, rows and views.
 */
export type ListPosition =
  'start' | 'end' | { index: number } | { before: string } | { after: string };

/**
 * Converts a {@link ListPosition} to an index into `siblings` (sorted, without the moving item).
 * Throws {@link NotFoundError} when a `before`/`after` anchor is not among the siblings.
 */
export function positionToIndex(siblings: readonly Ordered[], position: ListPosition): number {
  if (position === 'start') return 0;
  if (position === 'end') return siblings.length;
  if ('index' in position) return position.index;
  const anchor = 'before' in position ? position.before : position.after;
  const at = siblings.findIndex((sibling) => sibling.id === anchor);
  if (at < 0) throw new NotFoundError('Sibling', anchor);
  return 'before' in position ? at : at + 1;
}
