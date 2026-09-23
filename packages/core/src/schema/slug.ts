// Its own module: the shell uses it for URLs, and importing it must not pull in the DocJSON
// helpers (and ProseMirror) that `extract.ts` depends on.

/**
 * URL fragment slug for a heading: lowercase, spaces to `-`, letters/digits/dashes only (unicode
 * letters kept).
 *
 * @example
 * headingSlug('Launch Plan: Q3!'); // 'launch-plan-q3'
 */
export function headingSlug(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}
