import type {
  DateConfig,
  DateValue,
  JsonValue,
  NumberConfig,
  PropertyDefinition,
} from '@tessera/core';
import { readDateValue } from './cells';
import {
  dayKeyOfInstant,
  daysBetween,
  timeOfInstant,
  todayKey,
  zoneOffset,
  type DayKey,
} from './dates';
import type { QueryContext } from './types';

/*
 * Formatting for display (locale-aware, using the property's number and date configs) and plain
 * text for CSV export, copying cells, search and type conversion (stable, locale-neutral).
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function cached<T>(map: Map<string, T>, key: string, create: () => T): T {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached(numberFormats, `${locale}|${JSON.stringify(options)}`, () => {
    try {
      return new Intl.NumberFormat(locale, options);
    } catch {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 });
    }
  });
}

/** Removes binary floating-point noise (0.1 + 0.2 → 0.3) without losing real precision. */
export function cleanNumber(value: number): number {
  return Number.parseFloat(value.toPrecision(15));
}

/**
 * Formats a number with its property's config: plain, percent (the stored ratio × 100) or
 * currency. `precision` null means automatic.
 *
 * @example
 * formatNumber(0.256, { format: 'percent', currency: 'USD', precision: 1 }, 'en-US'); // "25.6%"
 */
export function formatNumber(
  value: number,
  config: NumberConfig | undefined,
  locale: string,
): string {
  const precision = config?.precision ?? null;
  const digits: Intl.NumberFormatOptions =
    precision === null
      ? { maximumFractionDigits: 10 }
      : { minimumFractionDigits: precision, maximumFractionDigits: precision };
  switch (config?.format ?? 'plain') {
    case 'percent':
      return numberFormat(locale, { style: 'percent', ...digits }).format(cleanNumber(value));
    case 'currency': {
      const options: Intl.NumberFormatOptions = {
        style: 'currency',
        currency: config?.currency ?? 'USD',
      };
      if (precision !== null) Object.assign(options, digits);
      return numberFormat(locale, options).format(value);
    }
    default:
      return numberFormat(locale, digits).format(cleanNumber(value));
  }
}

/** A number as locale-neutral text: `1234.5`, or `25%` for percent properties. */
export function numberToPlainText(value: number, config: NumberConfig | undefined): string {
  if (config?.format === 'percent') return `${cleanNumber(value * 100)}%`;
  return String(cleanNumber(value));
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const usableZones = new Map<string, boolean>();

function isUsableZone(timeZone: string): boolean {
  let usable = usableZones.get(timeZone);
  if (usable === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      usable = true;
    } catch {
      usable = false;
    }
    if (usableZones.size < 1000) usableZones.set(timeZone, usable);
  }
  return usable;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(dateFormats, `${locale}|${JSON.stringify(options)}`, () => {
    try {
      return new Intl.DateTimeFormat(locale, options);
    } catch {
      return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
    }
  });
}

function hourCycle(config: DateConfig | undefined): Intl.DateTimeFormatOptions {
  if (config?.timeFormat === '12h') return { hourCycle: 'h12' };
  if (config?.timeFormat === '24h') return { hourCycle: 'h23' };
  return {};
}

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats a calendar day (no time, no zone). */
export function formatDay(day: DayKey, config: DateConfig | undefined, ctx: QueryContext): string {
  const format = config?.format ?? 'medium';
  if (format === 'iso') return day;
  if (format === 'relative') {
    const diff = daysBetween(todayKey(ctx.now, ctx.timeZone), day);
    if (Math.abs(diff) <= 6) {
      const rtf = cached(
        relativeFormats,
        ctx.locale,
        () => new Intl.RelativeTimeFormat(ctx.locale, { numeric: 'auto' }),
      );
      return capitalize(rtf.format(diff, 'day'), ctx.locale);
    }
  }
  const style = format === 'short' || format === 'long' ? format : 'medium';
  return dateFormat(ctx.locale, { dateStyle: style, timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );
}

function formatInstantIn(
  ms: number,
  timeZone: string,
  config: DateConfig | undefined,
  ctx: QueryContext,
  showZone: boolean,
): string {
  const format = config?.format ?? 'medium';
  const zoneName = showZone
    ? ` ${
        dateFormat(ctx.locale, { timeZone, timeZoneName: 'short' })
          .formatToParts(ms)
          .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
      }`
    : '';
  if (format === 'iso') {
    const { hour, minute } = timeOfInstant(ms, timeZone);
    return `${dayKeyOfInstant(ms, timeZone)} ${pad2(hour)}:${pad2(minute)}${zoneName}`;
  }
  const time = dateFormat(ctx.locale, {
    timeStyle: 'short',
    timeZone,
    ...hourCycle(config),
  }).format(ms);
  return `${formatDay(dayKeyOfInstant(ms, timeZone), config, ctx)} ${time}${zoneName}`;
}

/**
 * Formats a date value for display with the property's date config. Date-only values never shift
 * across zones; values with a time show in their own zone when they have one (with its name when
 * it differs from the viewer's), else in the viewer's zone. Ranges read `start → end`.
 *
 * @example
 * formatDateValue({ start: '2026-09-23' }, { format: 'long', timeFormat: 'locale' }, ctx); // "September 23, 2026"
 */
export function formatDateValue(
  value: DateValue,
  config: DateConfig | undefined,
  ctx: QueryContext,
): string {
  if (!value.includeTime) {
    const start = formatDay(value.start, config, ctx);
    return value.end && value.end !== value.start
      ? `${start} → ${formatDay(value.end, config, ctx)}`
      : start;
  }
  const own = value.timeZone && isUsableZone(value.timeZone) ? value.timeZone : null;
  const zone = own ?? ctx.timeZone;
  const showZone = own !== null && own !== ctx.timeZone;
  const start = formatInstantIn(Date.parse(value.start), zone, config, ctx, showZone);
  if (!value.end) return start;
  return `${start} → ${formatInstantIn(Date.parse(value.end), zone, config, ctx, showZone)}`;
}

/** Formats an instant (created and updated times). */
export function formatInstant(
  ms: number,
  config: DateConfig | undefined,
  ctx: QueryContext,
): string {
  return formatInstantIn(ms, ctx.timeZone, config, ctx, false);
}

/** An instant as `YYYY-MM-DD HH:mm` in a zone. */
function instantText(ms: number, timeZone: string): string {
  const local = new Date(ms + zoneOffset(ms, timeZone));
  return `${String(local.getUTCFullYear()).padStart(4, '0')}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())} ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
}

/** A date value as stable text: `2026-09-23`, `2026-09-23 14:30`, ranges joined with ` → `. */
export function dateToPlainText(value: DateValue, ctx: QueryContext): string {
  if (!value.includeTime) return value.end ? `${value.start} → ${value.end}` : value.start;
  const zone = value.timeZone && isUsableZone(value.timeZone) ? value.timeZone : ctx.timeZone;
  const start = instantText(Date.parse(value.start), zone);
  return value.end ? `${start} → ${instantText(Date.parse(value.end), zone)}` : start;
}

// ---------------------------------------------------------------------------------------------
// Plain text of any cell
// ---------------------------------------------------------------------------------------------

/** Words used for checkboxes in plain text (CSV export and copying). */
export const CHECKBOX_TEXT = { checked: 'Yes', unchecked: 'No' } as const;

/**
 * A cell's value as plain text: the title or text as is, numbers locale-neutral (`25%` for
 * percent), option names (multi-select joined by `, `), dates as `YYYY-MM-DD` (`YYYY-MM-DD HH:mm`
 * with a time, ranges with ` → `), checkboxes as Yes/No, relations as the titles of their visible
 * pages. Pass a value read with `readCell` (validated); anything else yields `''`. For many rows,
 * build a {@link cellTextFormatter} once instead.
 */
export function cellToText(
  value: JsonValue,
  property: PropertyDefinition,
  ctx: QueryContext,
): string {
  return cellTextFormatter(property, ctx)(value);
}

/** {@link cellToText} for one property, with its lookups prepared once. */
export function cellTextFormatter(
  property: PropertyDefinition,
  ctx: QueryContext,
): (value: JsonValue) => string {
  const names = new Map(property.options?.map((option) => [option.id, option.name]));
  return (value) => formatCellText(value, property, ctx, names);
}

function formatCellText(
  value: JsonValue,
  property: PropertyDefinition,
  ctx: QueryContext,
  names: ReadonlyMap<string, string>,
): string {
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
      return typeof value === 'string' ? value : '';
    case 'number':
      return typeof value === 'number' ? numberToPlainText(value, property.number) : '';
    case 'select':
      return typeof value === 'string' ? (names.get(value) ?? '') : '';
    case 'multiSelect': {
      if (!Array.isArray(value)) return '';
      let text = '';
      for (const id of value) {
        const name = typeof id === 'string' ? names.get(id) : undefined;
        if (name !== undefined) text = text ? `${text}, ${name}` : name;
      }
      return text;
    }
    case 'date': {
      const date = readDateValue(value);
      return date ? dateToPlainText(date, ctx) : '';
    }
    case 'checkbox':
      return value === true ? CHECKBOX_TEXT.checked : CHECKBOX_TEXT.unchecked;
    case 'relation': {
      if (!Array.isArray(value)) return '';
      return value
        .filter(
          (id): id is string =>
            typeof id === 'string' && (ctx.isPageVisible ? ctx.isPageVisible(id) : true),
        )
        .map((id) => ctx.titleOf?.(id) ?? '')
        .filter((title) => title.trim() !== '')
        .join(', ');
    }
    case 'createdTime':
    case 'updatedTime':
      return typeof value === 'number'
        ? dateToPlainText({ start: new Date(value).toISOString(), includeTime: true }, ctx)
        : '';
    case 'formula': {
      if (typeof value === 'string') return value;
      if (typeof value === 'number') return String(cleanNumber(value));
      if (typeof value === 'boolean')
        return value ? CHECKBOX_TEXT.checked : CHECKBOX_TEXT.unchecked;
      const date = readDateValue(value);
      return date ? dateToPlainText(date, ctx) : '';
    }
  }
}
