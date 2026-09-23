import type { JsonValue } from '@tessera/core';

/**
 * The part of a row the query engine reads. Core's `ResolvedRow` (from `resolveRows`) satisfies
 * it, so views pass their rows straight in; plugins and exporters can build rows by hand.
 */
export interface QueryRow {
  id: string;
  /** Manual order (fractional index); input order is kept as the final tie-break. */
  order: string;
  /** Stored values by property ID, as they are in the database doc (not validated). */
  values: Readonly<Record<string, JsonValue>>;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Rows whose page is in the trash are dropped by {@link runQuery}. */
  trashed?: boolean;
  /** Rows whose page metadata has not arrived yet are dropped by {@link runQuery}. */
  missingPage?: boolean;
}

/**
 * Everything about the viewer that changes results: the clock (relative dates), the time zone
 * (dates compare by calendar day in the viewer's zone), the locale (string sorting and number
 * formats) and the first day of the week. Build one with {@link createQueryContext}.
 */
export interface QueryContext {
  /** Epoch milliseconds treated as "now". */
  now: number;
  /** IANA time zone of the viewer, for example `Europe/Paris`. */
  timeZone: string;
  /** BCP 47 locale, for example `en-US`. */
  locale: string;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  /** Title of a page, for relation sorting, search and text conversion. Defaults to none. */
  titleOf?: (pageId: string) => string | undefined;
  /**
   * Whether a related page counts. Relations to trashed or missing pages stay stored (restoring
   * brings them back) but views hide them; pass a predicate so filters and summaries agree.
   */
  isPageVisible?: (pageId: string) => boolean;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(locale: string): boolean {
  try {
    return Intl.Collator.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

/** The viewer's time zone according to the runtime (UTC when unknown). */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Creates a {@link QueryContext}, filling in the system clock, time zone and locale. Invalid time
 * zones fall back to UTC and invalid locales to `en-US`, so a bad setting never breaks a view.
 *
 * @example
 * const ctx = createQueryContext({ timeZone: 'America/New_York', weekStartsOn: 0 });
 */
export function createQueryContext(input: Partial<QueryContext> = {}): QueryContext {
  const timeZone =
    input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : systemTimeZone();
  const fallbackLocale =
    typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
  const requested = input.locale ?? fallbackLocale;
  const context: QueryContext = {
    now: input.now ?? Date.now(),
    timeZone,
    locale: isValidLocale(requested) ? requested : 'en-US',
    weekStartsOn: input.weekStartsOn ?? 1,
  };
  if (input.titleOf) context.titleOf = input.titleOf;
  if (input.isPageVisible) context.isPageVisible = input.isPageVisible;
  return context;
}
