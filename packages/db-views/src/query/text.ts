/** Text helpers shared by filters, sorting and search. */

const collators = new Map<string, Intl.Collator>();

/**
 * A cached, locale-aware collator for sorting: numeric (`Item 2` before `Item 10`) and
 * case-aware, so the order is total and stable across runs.
 */
export function sortCollator(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, usage: 'sort' });
    collators.set(locale, collator);
  }
  return collator;
}

// eslint-disable-next-line no-control-regex -- matches every character outside 7-bit ASCII
const NON_ASCII = /[^\x00-\x7f]/;
const COMBINING_MARKS = /\p{M}+/gu;

/** Lowercase, Unicode-normalized text for case-insensitive comparisons (`is`, `contains`, …). */
export function lowerText(text: string): string {
  return NON_ASCII.test(text) ? text.normalize('NFC').toLowerCase() : text.toLowerCase();
}

/**
 * Lowercase text without accents, for search (`resume` finds `Résumé`). Plain ASCII skips the
 * Unicode work, which keeps searching 10,000 rows fast.
 */
export function foldText(text: string): string {
  if (!NON_ASCII.test(text)) return text.toLowerCase();
  return text.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}
