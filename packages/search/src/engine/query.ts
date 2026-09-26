import { normalizeTagName, type PageKind } from '@tessera/core';

/**
 * Query syntax, shared by the palette, the search page and `SearchIndex.query`:
 *
 * - free words: full-text search (fuzzy and prefix);
 * - `tag:name` or `#name`: pages with that tag (nested tags match their parents: `tag:area`
 *   finds `#area/work`);
 * - `in:Title` or `in:"Two words"`: pages inside that page's subtree;
 * - `type:page` or `type:database`;
 * - `is:task`: pages with tasks.
 *
 * Unknown `key:value` pairs are searched as text.
 */
export interface ParsedQuery {
  /** The free text, filters removed. */
  text: string;
  /** Tag names without `#`, as written. */
  tags: string[];
  /** Page titles from `in:` filters. */
  within: string[];
  kinds: PageKind[];
  hasTasks: boolean;
}

/** A piece of a query: `key:"quoted value"`, `"a phrase"` or a bare word. */
export type QueryToken =
  | { kind: 'quoted'; key: string; value: string }
  | { kind: 'phrase'; text: string }
  | { kind: 'word'; text: string };

const SPACE = /\s/;
/** `key:"` at the start of a word; a key has no whitespace, colon or quote. */
const QUOTED_KEY = /^([^\s:"]+):"/;

/**
 * Splits a query into tokens in one forward scan. A quote runs to the next quote (spaces
 * included) or to the end. (A single regex with the three forms as alternatives was flagged by
 * CodeQL, js/polynomial-redos: its key pattern could be retried from every position of a run.)
 */
export function tokenizeQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  const quoteEnd = (from: number) => {
    const close = query.indexOf('"', from);
    return close === -1 ? query.length : close;
  };
  let index = 0;
  while (index < query.length) {
    if (SPACE.test(query.charAt(index))) {
      index += 1;
      continue;
    }
    if (query.charAt(index) === '"') {
      const end = quoteEnd(index + 1);
      tokens.push({ kind: 'phrase', text: query.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    let end = index;
    while (end < query.length && !SPACE.test(query.charAt(end))) end += 1;
    const word = query.slice(index, end);
    const key = QUOTED_KEY.exec(word);
    if (key?.[1]) {
      const valueStart = index + key[0].length;
      const valueEnd = quoteEnd(valueStart);
      tokens.push({ kind: 'quoted', key: key[1], value: query.slice(valueStart, valueEnd) });
      index = valueEnd + 1;
      continue;
    }
    tokens.push({ kind: 'word', text: word });
    index = end;
  }
  return tokens;
}

/** Splits a query into free text and filters. */
export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { text: '', tags: [], within: [], kinds: [], hasTasks: false };
  const words: string[] = [];
  for (const token of tokenizeQuery(query)) {
    if (token.kind === 'quoted') {
      if (!applyFilter(parsed, token.key, token.value)) words.push(token.value);
      continue;
    }
    if (token.kind === 'phrase') {
      words.push(token.text);
      continue;
    }
    const word = token.text;
    if (word.startsWith('#') && word.length > 1) {
      const tag = normalizeTagName(word);
      if (tag) {
        pushUnique(parsed.tags, tag);
        continue;
      }
    }
    const colon = word.indexOf(':');
    if (colon > 0 && applyFilter(parsed, word.slice(0, colon), word.slice(colon + 1))) continue;
    words.push(word);
  }
  parsed.text = words.join(' ').trim();
  return parsed;
}

function applyFilter(parsed: ParsedQuery, rawKey: string, rawValue: string): boolean {
  const key = rawKey.toLowerCase();
  const value = rawValue.trim();
  if (!value) return false;
  switch (key) {
    case 'tag': {
      const tag = normalizeTagName(value);
      if (!tag) return false;
      pushUnique(parsed.tags, tag);
      return true;
    }
    case 'in':
      pushUnique(parsed.within, value);
      return true;
    case 'type': {
      const kind = value.toLowerCase();
      if (kind === 'page' || kind === 'pages') pushUnique(parsed.kinds, 'page');
      else if (kind === 'database' || kind === 'databases' || kind === 'db')
        pushUnique(parsed.kinds, 'database');
      else return false;
      return true;
    }
    case 'is':
      if (value.toLowerCase() === 'task' || value.toLowerCase() === 'tasks') {
        parsed.hasTasks = true;
        return true;
      }
      return false;
    default:
      return false;
  }
}

function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

/** True when the query has at least one filter. */
export function hasFilters(parsed: ParsedQuery): boolean {
  return (
    parsed.tags.length > 0 || parsed.within.length > 0 || parsed.kinds.length > 0 || parsed.hasTasks
  );
}

function quoteIfNeeded(value: string): string {
  return /\s|"/.test(value) ? `"${value.replace(/"/g, '')}"` : value;
}

/**
 * Writes a parsed query back as a string (filters after the text), so UIs can toggle filters in
 * the query itself.
 *
 * @example
 * formatQuery({ ...parseQuery('apollo'), tags: ['space'] }); // 'apollo tag:space'
 */
export function formatQuery(parsed: ParsedQuery): string {
  const parts: string[] = [];
  if (parsed.text) parts.push(parsed.text);
  for (const tag of parsed.tags) parts.push(`tag:${tag}`);
  for (const title of parsed.within) parts.push(`in:${quoteIfNeeded(title)}`);
  for (const kind of parsed.kinds) parts.push(`type:${kind}`);
  if (parsed.hasTasks) parts.push('is:task');
  return parts.join(' ');
}
