import type { DateValue } from '@tessera/core';

/**
 * What formulas compute with: numbers, text, booleans, dates (the same shape as date property
 * values, so results can be shown, filtered and sorted like them) and empty (`null`).
 */
export type FormulaValue = number | string | boolean | DateValue | null;

/** Type names used in error messages (the UI translates `formulaType_<name>`). */
export type FormulaType = 'number' | 'text' | 'boolean' | 'date' | 'empty';

/** Longest text a formula may build. */
export const MAX_FORMULA_TEXT = 10_000;

export function isDateResult(value: FormulaValue): value is DateValue {
  return typeof value === 'object' && value !== null;
}

export function typeOf(value: FormulaValue): FormulaType {
  if (value === null) return 'empty';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'boolean') return 'boolean';
  return 'date';
}

/** Empty for `empty()` and filters: no value, or empty text. */
export function isEmptyResult(value: FormulaValue): boolean {
  return value === null || value === '';
}

/** Truthiness for `if`, `and`, `or` and `not`: false, 0, empty text and empty are false. */
export function truthy(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '';
  return true;
}
