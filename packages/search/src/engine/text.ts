import type { HighlightRange } from '@tessera/core';

/**
 * Text processing shared by indexing, querying and highlighting. Tokens are runs of characters
 * between whitespace and punctuation (MiniSearch's default tokenizer); terms are tokens folded to
 * lowercase without diacritics, so "Café" matches "cafe".
 */

const SEPARATOR = /[\n\r\p{Z}\p{P}]+/u;
const TOKEN = /[^\n\r\p{Z}\p{P}]+/gu;
const COMBINING_MARKS = /\p{M}+/gu;

/** Splits text into tokens. */
export function tokenize(text: string): string[] {
  return text.split(SEPARATOR).filter(Boolean);
}

/** Folds a token into a search term: NFKD, no combining marks, lowercase. Empty means skip. */
export function normalizeTerm(token: string): string {
  return token.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}

/** Tokens of `text` with their UTF-16 ranges. */
export function tokenSpans(text: string): Array<{ token: string; start: number; end: number }> {
  const spans: Array<{ token: string; start: number; end: number }> = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    spans.push({ token: match[0], start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Ranges of the tokens of `text` whose term is in `terms` (the document terms a query matched,
 * so prefix and fuzzy matches are highlighted as whole words).
 */
export function highlightTerms(text: string, terms: ReadonlySet<string>): HighlightRange[] {
  if (terms.size === 0 || !text) return [];
  const ranges: HighlightRange[] = [];
  for (const span of tokenSpans(text)) {
    if (terms.has(normalizeTerm(span.token))) ranges.push({ start: span.start, end: span.end });
  }
  return ranges;
}

/** True when at least one token of `text` is in `terms`. */
export function containsTerm(text: string, terms: ReadonlySet<string>): boolean {
  if (terms.size === 0 || !text) return false;
  return tokenSpans(text).some((span) => terms.has(normalizeTerm(span.token)));
}

const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 48;

/**
 * An excerpt of `text` around its first highlighted token, at most about 160 characters, cut at
 * word boundaries, with ellipses where it was cut and the highlights shifted into the excerpt.
 *
 * @example
 * snippetAround('…long text about the Apollo program…', new Set(['apollo']));
 */
export function snippetAround(
  text: string,
  terms: ReadonlySet<string>,
): { text: string; highlights: HighlightRange[] } {
  const flat = text.replace(/\s+/g, ' ').trim();
  const ranges = highlightTerms(flat, terms);
  const first = ranges[0];
  let start = 0;
  if (first && flat.length > SNIPPET_LENGTH && first.start > SNIPPET_LEAD) {
    start = first.start - SNIPPET_LEAD;
    const space = flat.indexOf(' ', start);
    if (space >= 0 && space < first.start) start = space + 1;
  }
  const body = cutAtWord(flat, start, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + body.length < flat.length ? '…' : '';
  const shift = prefix.length - start;
  const highlights = ranges
    .filter((range) => range.start >= start && range.end <= start + body.length)
    .map((range) => ({ start: range.start + shift, end: range.end + shift }));
  return { text: `${prefix}${body}${suffix}`, highlights };
}

function cutAtWord(text: string, start: number, end: number): string {
  if (end >= text.length) return text.slice(start);
  const space = text.lastIndexOf(' ', end);
  return text.slice(start, space > start + SNIPPET_LENGTH / 2 ? space : end).trimEnd();
}

/** Escapes a string for use in a regular expression. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
