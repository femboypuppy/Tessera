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

/**
 * `key:"quoted value"`, `"a phrase"` or a bare word. A key has no colon or quote, so a failed
 * `key:"` stops at the first one (an unbounded key rescanned the rest of `""""…` at every quote).
 */
const TOKEN = /([^\s:"]+):"([^"]*)"?|"([^"]*)"?|(\S+)/g;

/** Splits a query into free text and filters. */
export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { text: '', tags: [], within: [], kinds: [], hasTasks: false };
  const words: string[] = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(query); match; match = TOKEN.exec(query)) {
    const [, quotedKey, quotedValue, phrase, bare] = match;
    if (quotedKey !== undefined) {
      if (!applyFilter(parsed, quotedKey, quotedValue ?? '')) words.push(quotedValue ?? '');
      continue;
    }
    if (phrase !== undefined) {
      words.push(phrase);
      continue;
    }
    const word = bare ?? '';
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
