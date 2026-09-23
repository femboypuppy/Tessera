import type { NumberConfig, PropertyDefinition, PropertyType } from '@tessera/core';
import Papa from 'papaparse';
import { readCell } from '../query/cells';
import { cellTextFormatter } from '../query/format';
import {
  looksLikeEmail,
  looksLikeUrl,
  parseBooleanText,
  parseDateText,
  parseNumberText,
  splitNames,
} from '../query/parse';
import type { QueryContext, QueryRow } from '../query/types';

/** A parsed CSV file: the header row and the data rows (all padded to the header's width). */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** The biggest CSV file the importer reads. */
export const MAX_CSV_BYTES = 50 * 1024 * 1024;

/**
 * Parses CSV text (any common delimiter, quoted fields, a UTF-8 byte order mark). The first row
 * names the columns; empty names become "Column N" and repeated names get a number.
 */
export function parseCsv(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(source, { skipEmptyLines: 'greedy' });
  const [head = [], ...body] = parsed.data;
  const width = Math.max(head.length, ...body.map((row) => row.length), 0);
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, index) => {
    const base = (head[index] ?? '').replace(/[\r\n\t]+/g, ' ').trim() || `Column ${index + 1}`;
    const key = base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count > 1 ? `${base} (${count})` : base;
  });
  const rows = body.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  return { headers, rows };
}

/** How one CSV column becomes a property. */
export interface ColumnPlan {
  index: number;
  name: string;
  type: PropertyType;
  number?: Partial<NumberConfig>;
  /** Numeric dates read day-first (`23/09/2026`). */
  dayFirst?: boolean;
  /** Option names in order of first appearance (select and multi-select). */
  options?: string[];
}

const TITLE_NAMES = /^(name|title|task|item|page)$/i;
const MAX_SELECT_OPTIONS = 60;

/** Which column becomes the title: one named Name or Title, else the first. */
export function titleColumnIndex(headers: readonly string[]): number {
  const named = headers.findIndex((header) => TITLE_NAMES.test(header.trim()));
  return named >= 0 ? named : 0;
}

function distinctNames(values: readonly string[], split: boolean): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    for (const name of split ? splitNames(value) : [value.trim()]) {
      const key = name.toLowerCase();
      if (name && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

function numericDateNeedsDayFirst(values: readonly string[]): boolean {
  return values.some((value) => {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(value.trim());
    return !!match && Number(match[1]) > 12;
  });
}

/**
 * Guesses a property type per column from its values: checkbox (yes/no words), number (with
 * percent or a currency when every value has one), date (day-first when a numeric date says so),
 * URL, email, multi-select (comma-separated names that repeat), select (few distinct, short
 * values that repeat), else text. Empty columns are text.
 */
export function inferColumn(
  name: string,
  index: number,
  values: readonly string[],
  ctx: Pick<QueryContext, 'timeZone'>,
): ColumnPlan {
  const filled = values.map((value) => value.trim()).filter((value) => value !== '');
  const plan: ColumnPlan = { index, name, type: 'text' };
  if (filled.length === 0) return plan;

  if (filled.every((value) => parseBooleanText(value) !== null))
    return { ...plan, type: 'checkbox' };

  const numbers = filled.map((value) => parseNumberText(value));
  if (numbers.every((number) => number !== null)) {
    const parsed = numbers.filter(
      (number): number is NonNullable<typeof number> => number !== null,
    );
    const currencies = new Set(parsed.map((number) => number.currency));
    if (parsed.every((number) => number.percent))
      return { ...plan, type: 'number', number: { format: 'percent' } };
    const [currency] = [...currencies];
    if (currencies.size === 1 && currency)
      return { ...plan, type: 'number', number: { format: 'currency', currency } };
    return { ...plan, type: 'number' };
  }

  const dayFirst = numericDateNeedsDayFirst(filled);
  if (filled.every((value) => parseDateText(value, ctx, { dayFirst }) !== null)) {
    return dayFirst ? { ...plan, type: 'date', dayFirst } : { ...plan, type: 'date' };
  }
  if (filled.every(looksLikeUrl)) return { ...plan, type: 'url' };
  if (filled.every(looksLikeEmail)) return { ...plan, type: 'email' };

  const longest = Math.max(...filled.map((value) => value.length));
  if (filled.some((value) => value.includes(','))) {
    const tokens = filled.flatMap((value) => splitNames(value));
    const distinct = distinctNames(filled, true);
    const shortTokens = tokens.every((token) => token.length <= 40);
    if (shortTokens && distinct.length <= MAX_SELECT_OPTIONS && distinct.length < tokens.length) {
      return { ...plan, type: 'multiSelect', options: distinct };
    }
  }
  const distinct = distinctNames(filled, false);
  const repeats = distinct.length < filled.length;
  // In a small file, a few short labels (High, Low) are a select even without repeats; sentences
  // and numbers with a typo are not.
  const small =
    filled.length < 8 &&
    distinct.length <= 4 &&
    longest <= 24 &&
    numbers.every((number) => number === null);
  if (longest <= 60 && distinct.length <= MAX_SELECT_OPTIONS && (repeats || small)) {
    if (repeats && distinct.length <= Math.max(3, filled.length * 0.6))
      return { ...plan, type: 'select', options: distinct };
    if (small) return { ...plan, type: 'select', options: distinct };
  }
  return plan;
}

/** Infers every column: the title column first, then the others in file order. */
export function inferColumns(table: CsvTable, ctx: Pick<QueryContext, 'timeZone'>): ColumnPlan[] {
  const title = titleColumnIndex(table.headers);
  return table.headers.map((name, index) =>
    index === title
      ? { index, name, type: 'title' }
      : inferColumn(
          name,
          index,
          table.rows.map((row) => row[index] ?? ''),
          ctx,
        ),
  );
}

/** Option names of a column for a type (the plan may have been changed by the user). */
export function columnOptions(table: CsvTable, plan: ColumnPlan): string[] {
  if (plan.type !== 'select' && plan.type !== 'multiSelect') return [];
  return distinctNames(
    table.rows.map((row) => row[plan.index] ?? '').filter((value) => value.trim()),
    plan.type === 'multiSelect',
  ).slice(0, 500);
}

/** A safe file name for an export (`Reading list - Table.csv`). */
export function csvFileName(database: string, view: string): string {
  const name = `${database} - ${view}`
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name.slice(0, 120) || 'Database'}.csv`;
}

/**
 * The rows of a view as CSV: one column per visible property, in view order, values as plain text
 * (`cellToText`: option names, `YYYY-MM-DD` dates, Yes/No, page titles). Starts with a byte order
 * mark so spreadsheet apps read UTF-8.
 */
export function rowsToCsv(
  rows: readonly QueryRow[],
  columns: readonly PropertyDefinition[],
  ctx: QueryContext,
): string {
  const formatters = columns.map((property) => cellTextFormatter(property, ctx));
  const data = rows.map((row) =>
    columns.map((property, index) =>
      property.type === 'title' ? row.title : (formatters[index]?.(readCell(row, property)) ?? ''),
    ),
  );
  return `\uFEFF${Papa.unparse({ fields: columns.map((property) => property.name), data }, { newline: '\r\n' })}`;
}
