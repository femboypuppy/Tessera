import type { CalloutTone } from '@tessera/core';

/**
 * Obsidian callout types and their Tessera look (tone and emoji). Serializing picks the type whose
 * look matches exactly; any other combination is written as `[!<tone type>|<emoji>]`, which
 * Obsidian renders as the base type (it ignores the metadata after `|`), so every callout round
 * trips.
 */
export const CALLOUT_TYPES: ReadonlyArray<{ type: string; tone: CalloutTone; emoji: string }> = [
  { type: 'note', tone: 'default', emoji: '💡' },
  { type: 'info', tone: 'info', emoji: 'ℹ️' },
  { type: 'abstract', tone: 'info', emoji: '📋' },
  { type: 'todo', tone: 'info', emoji: '☑️' },
  { type: 'tip', tone: 'success', emoji: '🔥' },
  { type: 'success', tone: 'success', emoji: '✅' },
  { type: 'question', tone: 'warning', emoji: '❓' },
  { type: 'warning', tone: 'warning', emoji: '⚠️' },
  { type: 'failure', tone: 'danger', emoji: '❌' },
  { type: 'danger', tone: 'danger', emoji: '⚡' },
  { type: 'bug', tone: 'danger', emoji: '🐛' },
  { type: 'example', tone: 'default', emoji: '🧪' },
  { type: 'quote', tone: 'default', emoji: '💬' },
];

/** Obsidian's aliases for callout types. */
const CALLOUT_ALIASES: Readonly<Record<string, string>> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

/** The base type written for each tone when no type matches exactly. */
const TYPE_FOR_TONE: Readonly<Record<CalloutTone, string>> = {
  default: 'note',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** Metadata meaning "no emoji". */
const NO_ICON = 'no-icon';

const MARKER = /^\[!([A-Za-z0-9_-]+)(?:\|([^\]\n]*))?\]([+-])?/;

/** A parsed `[!type|meta]±` callout marker. */
export interface CalloutHeader {
  tone: CalloutTone;
  emoji: string | null;
  /** `null` = not foldable; `true` = foldable and open (`+`); `false` = folded (`-`). */
  foldOpen: boolean | null;
  /** Length of the marker in the source text. */
  length: number;
}

/** One grapheme that is not plain ASCII (Obsidian's own metadata, like `wide`, is ASCII). */
function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 32 || /^[\x20-\x7e]+$/.test(value) || /\s/.test(value)) return false;
  if (typeof Intl.Segmenter !== 'function') return true;
  return (
    [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length === 1
  );
}

/**
 * Parses a callout marker at the start of a blockquote's first line.
 *
 * @example
 * parseCalloutMarker('[!warning]- Careful'); // { tone: 'warning', emoji: '⚠️', foldOpen: false, length: 11 }
 */
export function parseCalloutMarker(text: string): CalloutHeader | null {
  const match = MARKER.exec(text);
  if (!match?.[1]) return null;
  const rawType = match[1].toLowerCase();
  const type = CALLOUT_ALIASES[rawType] ?? rawType;
  const base = CALLOUT_TYPES.find((entry) => entry.type === type) ?? CALLOUT_TYPES[0];
  let emoji: string | null = base?.emoji ?? '💡';
  const meta = match[2]?.trim();
  if (meta === NO_ICON) emoji = null;
  else if (meta && isSingleEmoji(meta)) emoji = meta;
  return {
    tone: base?.tone ?? 'default',
    emoji,
    foldOpen: match[3] === '+' ? true : match[3] === '-' ? false : null,
    length: match[0].length,
  };
}

/**
 * Formats a callout marker for a tone and emoji.
 *
 * @example
 * formatCalloutMarker('warning', '⚠️', null); // '[!warning]'
 * formatCalloutMarker('default', '🚀', false); // '[!note|🚀]-'
 */
export function formatCalloutMarker(
  tone: CalloutTone,
  emoji: string | null,
  foldOpen: boolean | null,
): string {
  const exact = CALLOUT_TYPES.find((entry) => entry.tone === tone && entry.emoji === emoji);
  const type = exact?.type ?? TYPE_FOR_TONE[tone];
  const meta = exact ? '' : `|${emoji === null ? NO_ICON : emoji.replace(/[\]\n|]/g, '')}`;
  const fold = foldOpen === null ? '' : foldOpen ? '+' : '-';
  return `[!${type}${meta}]${fold}`;
}
