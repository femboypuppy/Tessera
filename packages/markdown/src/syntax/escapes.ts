import type { Root } from 'mdast';
import type { CompileContext, Extension } from 'mdast-util-from-markdown';
import type { Token } from 'micromark-util-types';
import { visit } from 'unist-util-visit';

/**
 * Escaped autolink characters.
 *
 * To keep text like `see http://example.com` or `bob@example.com` plain on the way back, the
 * serializer escapes the character that would start a GFM autolink literal (`http\://`, `www\.`,
 * `bob\@`). But GFM links literals in a tree transform, after escapes are resolved into text, so
 * the escape alone never stopped it: every plain URL or email came back as a link. While parsing,
 * an escaped `@`, `:` or `.` is therefore written into the text as a stand-in from the last
 * private-use plane, which the literal patterns can't match; {@link restoreEscapes} puts the real
 * characters back once the tree is complete.
 */
const STAND_INS = new Map([
  ['@', '\u{10FFF0}'],
  [':', '\u{10FFF1}'],
  ['.', '\u{10FFF2}'],
]);
const REAL = new Map([...STAND_INS].map(([real, standIn]) => [standIn, real]));
const HAS_STAND_IN = /[\u{10FFF0}-\u{10FFF2}]/u;
const EVERY_STAND_IN = /[\u{10FFF0}-\u{10FFF2}]/gu;

/** The default handler for escaped characters, with the stand-ins above. */
function exitCharacterEscapeValue(this: CompileContext, token: Token): undefined {
  const tail = this.stack.pop() as unknown as {
    value: string;
    position?: { end: { line: number; column: number; offset?: number } };
  };
  const character = this.sliceSerialize(token);
  tail.value += STAND_INS.get(character) ?? character;
  if (tail.position)
    tail.position.end = {
      line: token.end.line,
      column: token.end.column,
      offset: token.end.offset,
    };
  return undefined;
}

/** from-markdown extension: escaped `@`, `:` and `.` become stand-ins until {@link restoreEscapes}. */
export function escapesFromMarkdown(): Extension {
  return { exit: { characterEscapeValue: exitCharacterEscapeValue } };
}

/** Puts the real characters back in every string of a parsed tree (after GFM ran). */
export function restoreEscapes(tree: Root): Root {
  visit(tree, (node) => {
    const fields = node as unknown as Record<string, unknown>;
    for (const key of ['value', 'url', 'title', 'alt', 'label', 'identifier']) {
      const value = fields[key];
      if (typeof value === 'string' && HAS_STAND_IN.test(value)) {
        fields[key] = value.replace(EVERY_STAND_IN, (standIn) => REAL.get(standIn) ?? standIn);
      }
    }
  });
  return tree;
}
