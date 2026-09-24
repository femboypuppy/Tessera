/** Words, characters and reading time of a page's markdown. */
export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  paragraphs: number;
  /** Minutes at 238 words per minute (the average adult silent reading speed). */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 238;

/** Removes markdown syntax, keeping the text people read. */
export function stripMarkdown(markdown: string): string {
  return (
    markdown
      .replace(/\r\n?/g, '\n')
      // Front matter.
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      // Fenced code keeps its content; only the fences go.
      .replace(/^```.*$/gm, '')
      // Images disappear; links keep their text.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Wikilinks show their alias, or their target.
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      // Horizontal rules and table separators. Line patterns use [ \t], never \s: \s would
      // swallow the blank lines that separate paragraphs.
      .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
      .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/gm, '')
      // Headings, quotes, list markers and task boxes.
      .replace(/^[ \t]{0,3}(#{1,6}|>+)[ \t]?/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
      // Emphasis, code and strikethrough markers.
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|\W)[*_](\S)/g, '$1$2')
      .replace(/(\S)[*_](?=\W|$)/g, '$1')
      .replace(/\|/g, ' ')
  );
}

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

function countWords(text: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    let words = 0;
    for (const segment of new Segmenter(undefined, { granularity: 'word' }).segment(text))
      if (segment.isWordLike) words += 1;
    return words;
  }
  return text.match(WORD)?.length ?? 0;
}

/** Counts a page. */
export function countText(markdown: string): TextStats {
  const text = stripMarkdown(markdown);
  const words = countWords(text);
  const visible = text.replace(/\n+/g, ' ').trim();
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean).length;
  return {
    words,
    characters: visible.length,
    charactersNoSpaces: visible.replace(/\s/g, '').length,
    paragraphs,
    readingMinutes: words / WORDS_PER_MINUTE,
  };
}

/** "Less than a minute", "4 min", "1 h 12 min". */
export function formatReadingTime(minutes: number): string {
  if (minutes < 1) return 'Under a minute';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
