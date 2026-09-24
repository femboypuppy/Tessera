/**
 * The text between `[[` and `]]`: `target#heading|alias`, `target#^block|alias` (Obsidian) or
 * `target^block`. Backslash escapes keep brackets and separators literal.
 */
export interface WikiLinkParts {
  /** The page or file (before `#`, `^` and `|`). Empty for links inside the same page (`[[#Heading]]`). */
  target: string;
  heading: string | null;
  blockRef: string | null;
  alias: string | null;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function indexOfUnescaped(value: string, character: string, from = 0): number {
  for (let i = from; i < value.length; i += 1) {
    if (value[i] === character && !isEscaped(value, i)) return i;
  }
  return -1;
}

function splitUnescaped(value: string, character: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (
    let i = indexOfUnescaped(value, character);
    i >= 0;
    i = indexOfUnescaped(value, character, i + 1)
  ) {
    parts.push(value.slice(start, i));
    start = i + 1;
  }
  parts.push(value.slice(start));
  return parts;
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

/**
 * Parses the raw text of a wikilink. `inTableCell` undoes the `\|` escaping that tables need.
 *
 * @example
 * parseWikiLink('Projects/Apollo#Launch plan|the plan');
 * // { target: 'Projects/Apollo', heading: 'Launch plan', blockRef: null, alias: 'the plan' }
 */
export function parseWikiLink(raw: string, inTableCell = false): WikiLinkParts {
  const value = inTableCell ? raw.replace(/\\\|/g, '|') : raw;
  const pipe = indexOfUnescaped(value, '|');
  const main = pipe >= 0 ? value.slice(0, pipe) : value;
  const aliasRaw = pipe >= 0 ? value.slice(pipe + 1) : null;
  let targetRaw = main;
  let heading: string | null = null;
  let blockRef: string | null = null;
  const hash = indexOfUnescaped(main, '#');
  if (hash >= 0) {
    targetRaw = main.slice(0, hash);
    // Obsidian allows nested heading paths (`Page#H1#H2`): the last heading is the target.
    for (const segment of splitUnescaped(main.slice(hash + 1), '#')) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('^')) blockRef = unescape(trimmed.slice(1));
      else heading = unescape(trimmed);
    }
  } else {
    const caret = indexOfUnescaped(main, '^');
    if (caret >= 0) {
      targetRaw = main.slice(0, caret);
      blockRef = unescape(main.slice(caret + 1)).trim() || null;
    }
  }
  const alias = aliasRaw === null ? null : unescape(aliasRaw).trim();
  return {
    target: unescape(targetRaw).trim(),
    heading,
    blockRef,
    alias: alias || null,
  };
}

function escapeTarget(value: string): string {
  return value.replace(/\|/g, '-').replace(/[\\[\]#^]/g, '\\$&');
}

function escapeAlias(value: string): string {
  return value.replace(/[\\[\]]/g, '\\$&');
}

/**
 * Formats wikilink parts as the raw text between `[[` and `]]` (the inverse of
 * {@link parseWikiLink}). Line breaks become spaces; `|` in targets and headings becomes `-`
 * (Obsidian forbids it in file names).
 */
export function formatWikiLink(parts: WikiLinkParts): string {
  const clean = (value: string) => value.replace(/[\r\n]+/g, ' ');
  let value = escapeTarget(clean(parts.target));
  if (parts.heading) value += `#${escapeTarget(clean(parts.heading))}`;
  if (parts.blockRef) value += `#^${parts.blockRef}`;
  if (parts.alias) value += `|${escapeAlias(clean(parts.alias))}`;
  return value;
}
