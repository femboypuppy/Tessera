import { EMPTY_GROUP_KEY, type JsonValue, type PropertyDefinition } from '@tessera/core';

/** Sortable IDs of cards: a multi-select row appears in several columns, so IDs carry the group. */
export function cardId(groupKey: string, rowId: string): string {
  return `${groupKey}|${rowId}`;
}

/** The droppable ID of a column. */
export function columnId(groupKey: string): string {
  return `column|${groupKey}`;
}

/** Splits a card or column ID. */
export function parseDragId(id: string): { groupKey: string; rowId: string | null } {
  if (id.startsWith('column|')) return { groupKey: id.slice('column|'.length), rowId: null };
  const at = id.lastIndexOf('|');
  return at < 0
    ? { groupKey: id, rowId: null }
    : { groupKey: id.slice(0, at), rowId: id.slice(at + 1) };
}

/**
 * The value a row gets when its card moves from one group to another: the target option for a
 * select (none for the empty group), the source option swapped for the target in a multi-select,
 * and checked or unchecked for a checkbox. Returns undefined when nothing changes.
 */
export function valueForGroupMove(
  property: PropertyDefinition,
  current: JsonValue | undefined,
  fromKey: string,
  toKey: string,
): JsonValue | null | undefined {
  if (fromKey === toKey) return undefined;
  const known = new Set(property.options?.map((option) => option.id));
  switch (property.type) {
    case 'select':
      if (toKey === EMPTY_GROUP_KEY) return null;
      return known.has(toKey) ? toKey : undefined;
    case 'multiSelect': {
      const ids = Array.isArray(current)
        ? current.filter((id): id is string => typeof id === 'string' && known.has(id))
        : [];
      const next = ids.filter((id) => id !== fromKey);
      if (toKey !== EMPTY_GROUP_KEY) {
        if (!known.has(toKey)) return undefined;
        if (!next.includes(toKey)) next.push(toKey);
      }
      return next.length > 0 ? next : null;
    }
    case 'checkbox':
      return toKey === 'true' ? true : null;
    default:
      return undefined;
  }
}

/** A group order with `key` moved by `offset` (materializing the current order). */
export function moveGroupKey(order: readonly string[], key: string, offset: number): string[] {
  const list = [...order];
  const from = list.indexOf(key);
  if (from < 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + offset));
  list.splice(from, 1);
  list.splice(to, 0, key);
  return list;
}
