/**
 * The functions formulas can call: names, how many arguments they take and how they read. The
 * evaluator implements them; the formula editor lists them (descriptions are translated in the
 * UI as `formulaFn_<name>`). Names are case-insensitive.
 */

export type FunctionCategory = 'logic' | 'math' | 'text' | 'date';

export interface FormulaFunction {
  name: string;
  category: FunctionCategory;
  min: number;
  /** `Infinity` for functions that take any number of arguments. */
  max: number;
  /** How a call reads, shown in the editor. */
  signature: string;
}

export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  { name: 'if', category: 'logic', min: 2, max: 3, signature: 'if(condition, then, else)' },
  { name: 'and', category: 'logic', min: 1, max: Infinity, signature: 'and(a, b, …)' },
  { name: 'or', category: 'logic', min: 1, max: Infinity, signature: 'or(a, b, …)' },
  { name: 'not', category: 'logic', min: 1, max: 1, signature: 'not(value)' },
  { name: 'empty', category: 'logic', min: 1, max: 1, signature: 'empty(value)' },

  { name: 'abs', category: 'math', min: 1, max: 1, signature: 'abs(number)' },
  { name: 'round', category: 'math', min: 1, max: 2, signature: 'round(number, digits)' },
  { name: 'floor', category: 'math', min: 1, max: 1, signature: 'floor(number)' },
  { name: 'ceil', category: 'math', min: 1, max: 1, signature: 'ceil(number)' },
  { name: 'sqrt', category: 'math', min: 1, max: 1, signature: 'sqrt(number)' },
  { name: 'pow', category: 'math', min: 2, max: 2, signature: 'pow(base, exponent)' },
  { name: 'sign', category: 'math', min: 1, max: 1, signature: 'sign(number)' },
  { name: 'min', category: 'math', min: 1, max: Infinity, signature: 'min(a, b, …)' },
  { name: 'max', category: 'math', min: 1, max: Infinity, signature: 'max(a, b, …)' },
  { name: 'sum', category: 'math', min: 1, max: Infinity, signature: 'sum(a, b, …)' },
  { name: 'toNumber', category: 'math', min: 1, max: 1, signature: 'toNumber(value)' },

  { name: 'concat', category: 'text', min: 1, max: Infinity, signature: 'concat(a, b, …)' },
  { name: 'format', category: 'text', min: 1, max: 1, signature: 'format(value)' },
  { name: 'length', category: 'text', min: 1, max: 1, signature: 'length(text)' },
  { name: 'lower', category: 'text', min: 1, max: 1, signature: 'lower(text)' },
  { name: 'upper', category: 'text', min: 1, max: 1, signature: 'upper(text)' },
  { name: 'trim', category: 'text', min: 1, max: 1, signature: 'trim(text)' },
  { name: 'contains', category: 'text', min: 2, max: 2, signature: 'contains(text, search)' },
  { name: 'startsWith', category: 'text', min: 2, max: 2, signature: 'startsWith(text, start)' },
  { name: 'endsWith', category: 'text', min: 2, max: 2, signature: 'endsWith(text, end)' },
  {
    name: 'replace',
    category: 'text',
    min: 3,
    max: 3,
    signature: 'replace(text, search, replacement)',
  },
  { name: 'slice', category: 'text', min: 2, max: 3, signature: 'slice(text, start, end)' },

  { name: 'now', category: 'date', min: 0, max: 0, signature: 'now()' },
  { name: 'today', category: 'date', min: 0, max: 0, signature: 'today()' },
  { name: 'dateAdd', category: 'date', min: 3, max: 3, signature: 'dateAdd(date, amount, "days")' },
  {
    name: 'dateSubtract',
    category: 'date',
    min: 3,
    max: 3,
    signature: 'dateSubtract(date, amount, "days")',
  },
  {
    name: 'dateBetween',
    category: 'date',
    min: 3,
    max: 3,
    signature: 'dateBetween(date1, date2, "days")',
  },
  { name: 'dateRange', category: 'date', min: 2, max: 2, signature: 'dateRange(start, end)' },
  { name: 'start', category: 'date', min: 1, max: 1, signature: 'start(date)' },
  { name: 'end', category: 'date', min: 1, max: 1, signature: 'end(date)' },
  { name: 'formatDate', category: 'date', min: 1, max: 1, signature: 'formatDate(date)' },
  { name: 'year', category: 'date', min: 1, max: 1, signature: 'year(date)' },
  { name: 'month', category: 'date', min: 1, max: 1, signature: 'month(date)' },
  { name: 'day', category: 'date', min: 1, max: 1, signature: 'day(date)' },
  { name: 'weekday', category: 'date', min: 1, max: 1, signature: 'weekday(date)' },
  { name: 'hour', category: 'date', min: 1, max: 1, signature: 'hour(date)' },
  { name: 'minute', category: 'date', min: 1, max: 1, signature: 'minute(date)' },
  { name: 'timestamp', category: 'date', min: 1, max: 1, signature: 'timestamp(date)' },
  { name: 'fromTimestamp', category: 'date', min: 1, max: 1, signature: 'fromTimestamp(ms)' },
];

const BY_NAME = new Map(FORMULA_FUNCTIONS.map((fn) => [fn.name.toLowerCase(), fn]));

/** A function by name, ignoring case. */
export function findFunction(name: string): FormulaFunction | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** Units of `dateAdd`, `dateSubtract` and `dateBetween`. */
export type DateUnit = 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes';

const UNITS: Readonly<Record<string, DateUnit>> = {
  year: 'years',
  years: 'years',
  y: 'years',
  quarter: 'quarters',
  quarters: 'quarters',
  q: 'quarters',
  month: 'months',
  months: 'months',
  week: 'weeks',
  weeks: 'weeks',
  w: 'weeks',
  day: 'days',
  days: 'days',
  d: 'days',
  hour: 'hours',
  hours: 'hours',
  h: 'hours',
  minute: 'minutes',
  minutes: 'minutes',
  min: 'minutes',
};

/** A unit name (singular, plural or short, any case), or null. */
export function dateUnit(text: string): DateUnit | null {
  return UNITS[text.trim().toLowerCase()] ?? null;
}
