/**
 * Formats a date with tokens, like most note apps:
 *
 * | Token  | Example   |
 * |--------|-----------|
 * | `YYYY` | 2026      |
 * | `YY`   | 26        |
 * | `MMMM` | September |
 * | `MMM`  | Sep       |
 * | `MM`   | 09        |
 * | `M`    | 9         |
 * | `DD`   | 03        |
 * | `D`    | 3         |
 * | `Do`   | 3rd       |
 * | `dddd` | Thursday  |
 * | `ddd`  | Thu       |
 *
 * Text in square brackets is kept as is: `[Week of] MMMM D`.
 */
export function formatDate(date: Date, format: string, locale = 'en-US'): string {
  const month = (style: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale, { month: style }).format(date);
  const weekday = (style: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale, { weekday: style }).format(date);
  const pad = (value: number) => String(value).padStart(2, '0');
  const values: Record<string, () => string> = {
    YYYY: () => String(date.getFullYear()),
    YY: () => pad(date.getFullYear() % 100),
    MMMM: () => month('long'),
    MMM: () => month('short'),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    DD: () => pad(date.getDate()),
    Do: () => ordinal(date.getDate()),
    D: () => String(date.getDate()),
    dddd: () => weekday('long'),
    ddd: () => weekday('short'),
  };
  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|Do|M|DD|D|dddd|ddd/g,
    (match, literal: string | undefined) => literal ?? values[match]?.() ?? match,
  );
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st… */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${{ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th'}`;
}

/** The date `days` away from `date` (local calendar days). */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
