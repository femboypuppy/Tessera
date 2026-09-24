import {
  isStoredPropertyType,
  type JsonValue,
  type PropertyDefinition,
  type PropertyType,
} from '@tessera/core';
import { readCell } from './cells';
import { cellToText } from './format';
import { parseBooleanText, parseCellText } from './parse';
import type { QueryContext, QueryRow } from './types';

/** What changing a property's type does to one row's stored value. */
export type ConvertedValue =
  | { kind: 'set'; value: JsonValue }
  /** Select and multi-select targets: option names, mapped to options (created if needed). */
  | { kind: 'options'; names: string[] };

/** The value conversions of a type change, computed without touching the doc. */
export interface TypeChangePlan {
  /** Rows whose stored value is replaced. Rows not listed keep their value untouched. */
  updates: Array<{ rowId: string; change: ConvertedValue }>;
}

function isEmptyValue(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Converts one stored value from `property`'s current type to `target`. Returns null to leave the
 * stored value in place: it is empty, unchecked, invalid for the current type (a leftover of an
 * earlier type, which becomes readable again when the type matches, as SPEC 4.5 asks) or it does
 * not convert. Conversions go through text, so `42` becomes `"42"` and back, option IDs become
 * names and back, and dates become `YYYY-MM-DD`. A formula's computed result (`raw` is then the
 * row's `formulas` entry) converts like a stored value, so turning a formula into text keeps it.
 */
export function convertValue(
  raw: JsonValue | undefined,
  row: QueryRow,
  property: PropertyDefinition,
  target: PropertyType,
  ctx: QueryContext,
): ConvertedValue | null {
  if (raw === undefined || target === property.type || !isStoredPropertyType(target)) return null;
  const computed = property.type === 'formula';
  if (!computed && !isStoredPropertyType(property.type)) return null;
  const current = readCell(row, property);
  // Empty, invalid (left over from an earlier type) and unchecked values stay where they are.
  if (isEmptyValue(current) || current === false) return null;

  const from = property.type;
  // Conversions that keep option identity (both types share the options map). Options that were
  // deleted meanwhile are dropped.
  const known = new Set(property.options?.map((option) => option.id));
  if (from === 'select' && target === 'multiSelect' && typeof current === 'string')
    return known.has(current) ? { kind: 'set', value: [current] } : null;
  if (from === 'multiSelect' && target === 'select' && Array.isArray(current)) {
    const first = current.find((id) => typeof id === 'string' && known.has(id));
    return typeof first === 'string' ? { kind: 'set', value: first } : null;
  }
  if ((from === 'number' || computed) && target === 'checkbox' && typeof current === 'number')
    return { kind: 'set', value: current !== 0 };
  if ((from === 'checkbox' || computed) && target === 'number' && typeof current === 'boolean')
    return { kind: 'set', value: current ? 1 : 0 };
  if (target === 'checkbox') {
    const text = cellToText(current, property, ctx);
    const checked = parseBooleanText(text, { numeric: true });
    return checked === null ? null : { kind: 'set', value: checked };
  }

  const text = cellToText(current, property, ctx);
  if (text.trim() === '') return null;
  const parsed = parseCellText(text, { ...property, type: target }, ctx);
  switch (parsed.kind) {
    case 'value':
      return parsed.value === null || isEmptyValue(parsed.value)
        ? null
        : { kind: 'set', value: parsed.value };
    case 'options':
      return parsed.names.length > 0 ? { kind: 'options', names: parsed.names } : null;
    default:
      // Relations cannot be rebuilt from text reliably; leave the value in place.
      return null;
  }
}

/**
 * Plans the value conversions for changing `property` to `target` over every row.
 *
 * @example
 * const plan = planTypeChange(rows, statusProperty, 'text', ctx);
 */
export function planTypeChange(
  rows: readonly QueryRow[],
  property: PropertyDefinition,
  target: PropertyType,
  ctx: QueryContext,
): TypeChangePlan {
  const updates: TypeChangePlan['updates'] = [];
  for (const row of rows) {
    const raw = property.type === 'formula' ? row.formulas?.[property.id] : row.values[property.id];
    const change = convertValue(raw, row, property, target, ctx);
    if (change) updates.push({ rowId: row.id, change });
  }
  return { updates };
}
