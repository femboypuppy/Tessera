import { InvalidOperationError } from '../errors';
import { nodeAtPath, walkDocJSON } from './docjson';
import { inlineText, type ExtractOptions } from './extract';
import type { AnyNodeJSON, DocJSON, PageLinkJSON } from './types';

/**
 * A text match inside a text block. `from`/`to` are inline offsets in ProseMirror convention:
 * every text character counts 1 and every inline atom (hard break, page link, tag) counts 1.
 */
export interface TextOccurrence {
  /** Path of the text block (paragraph, heading, toggle summary). */
  path: number[];
  from: number;
  to: number;
  /** The matched text as written in the document. */
  text: string;
  /** Display text of the whole block (context for UIs). */
  blockText: string;
}

/** Options for {@link findTextOccurrences}. */
export interface FindTextOptions extends ExtractOptions {
  /** Default false: matching is case-insensitive (Unicode aware). */
  caseSensitive?: boolean;
  /** Default true: only match whole words (letters, digits and `_` count as word characters). */
  wholeWord?: boolean;
  /** Default false: skip code blocks and text with the `code` mark. */
  includeCode?: boolean;
  /** Default false: skip text that already carries a `link` mark. */
  includeLinked?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Run {
  text: string;
  start: number;
  excluded: boolean[];
}

function runsOf(block: AnyNodeJSON, options: FindTextOptions): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let offset = 0;
  for (const child of block.content ?? []) {
    if (child.type !== 'text') {
      current = null;
      offset += 1;
      continue;
    }
    const text = child.text ?? '';
    const marks = child.marks ?? [];
    const excluded =
      (!options.includeCode && marks.some((mark) => mark.type === 'code')) ||
      (!options.includeLinked && marks.some((mark) => mark.type === 'link'));
    if (!current) {
      current = { text: '', start: offset, excluded: [] };
      runs.push(current);
    }
    current.text += text;
    for (let i = 0; i < text.length; i += 1) current.excluded.push(excluded);
    offset += text.length;
  }
  return runs;
}

/**
 * Finds every occurrence of any of `needles` (a title and its aliases, for example) in text runs.
 * Matches never span page links, tags or hard breaks, and never overlap (the earliest, then the
 * longest match wins).
 *
 * @example
 * const mentions = findTextOccurrences(doc, [page.title, ...aliases]);
 */
export function findTextOccurrences(
  doc: DocJSON,
  needles: string | readonly string[],
  options: FindTextOptions = {},
): TextOccurrence[] {
  const terms = [
    ...new Set(
      (typeof needles === 'string' ? [needles] : needles).map((n) => n.trim()).filter(Boolean),
    ),
  ];
  if (terms.length === 0) return [];
  const flags = options.caseSensitive ? 'gu' : 'giu';
  const wholeWord = options.wholeWord ?? true;
  const pattern = terms
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const regex = new RegExp(
    wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])` : `(?:${pattern})`,
    flags,
  );
  const results: TextOccurrence[] = [];
  walkDocJSON(doc, (node, path) => {
    if (node.type === 'codeBlock') return false;
    if (node.type !== 'paragraph' && node.type !== 'heading' && node.type !== 'toggleSummary')
      return undefined;
    const blockText = inlineText(node.content, options);
    for (const run of runsOf(node, options)) {
      regex.lastIndex = 0;
      for (let match = regex.exec(run.text); match; match = regex.exec(run.text)) {
        const text = match[0];
        const excluded = run.excluded.slice(match.index, match.index + text.length).some(Boolean);
        if (!excluded && text.length > 0) {
          results.push({
            path: [...path],
            from: run.start + match.index,
            to: run.start + match.index + text.length,
            text,
            blockText,
          });
        }
        if (text.length === 0) regex.lastIndex += 1;
      }
    }
    return false;
  });
  return results;
}

/** What to insert in place of the text in {@link replaceTextWithPageLink}. */
export interface PageLinkTarget {
  pageId: string;
  label?: string | null;
  heading?: string | null;
  blockRef?: string | null;
}

/**
 * Returns a copy of `doc` where the text range of `occurrence` is replaced by a `pageLink`. Throws
 * {@link InvalidOperationError} when the range no longer exists, spans an inline atom, or (with
 * `expectedText`) no longer contains the expected text, so stale results from an index are never
 * applied to edited content.
 *
 * @example
 * updateDocJSON(handle.doc, (doc) => replaceTextWithPageLink(doc, mention, { pageId }, { expectedText: mention.text }));
 */
export function replaceTextWithPageLink(
  doc: DocJSON,
  occurrence: Pick<TextOccurrence, 'path' | 'from' | 'to'>,
  target: PageLinkTarget,
  options: { expectedText?: string } = {},
): DocJSON {
  const copy = structuredClone(doc);
  const block = nodeAtPath(copy, occurrence.path);
  if (
    !block ||
    (block.type !== 'paragraph' && block.type !== 'heading' && block.type !== 'toggleSummary')
  ) {
    throw new InvalidOperationError('The text block no longer exists');
  }
  const { from, to } = occurrence;
  if (!(from < to)) throw new InvalidOperationError('Empty range');
  const before: AnyNodeJSON[] = [];
  const after: AnyNodeJSON[] = [];
  let removed = '';
  let offset = 0;
  for (const child of block.content ?? []) {
    const size = child.type === 'text' ? (child.text?.length ?? 0) : 1;
    const start = offset;
    const end = offset + size;
    offset = end;
    if (end <= from) {
      before.push(child);
      continue;
    }
    if (start >= to) {
      after.push(child);
      continue;
    }
    if (child.type !== 'text')
      throw new InvalidOperationError('The range spans a link, tag or line break');
    const text = child.text ?? '';
    const cutStart = Math.max(0, from - start);
    const cutEnd = Math.min(text.length, to - start);
    if (cutStart > 0) before.push({ ...child, text: text.slice(0, cutStart) });
    removed += text.slice(cutStart, cutEnd);
    if (cutEnd < text.length) after.push({ ...child, text: text.slice(cutEnd) });
  }
  if (removed.length !== to - from)
    throw new InvalidOperationError('The range is outside the text block');
  if (options.expectedText !== undefined && removed !== options.expectedText) {
    throw new InvalidOperationError('The text changed since it was found');
  }
  const link: PageLinkJSON = {
    type: 'pageLink',
    attrs: {
      pageId: target.pageId,
      label: target.label ?? null,
      heading: target.heading ?? null,
      blockRef: target.blockRef ?? null,
    },
  };
  block.content = [...before, link as AnyNodeJSON, ...after];
  return copy;
}
