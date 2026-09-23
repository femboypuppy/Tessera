import type { DocJSON, DocNode } from '../types';

/**
 * A deliberately small markdown ⇄ document conversion for the test harness: headings (`#` to
 * `###`) and paragraphs. The real app uses a full markdown codec; tests of plugin logic rarely
 * need more.
 */
export function markdownToDoc(markdown: string): DocJSON {
  const blocks = markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const content: DocNode[] = blocks.map((block) => {
    const heading = /^(#{1,3})\s+(.*)$/s.exec(block);
    const text = (heading ? heading[2] : block) ?? '';
    const inline: DocNode[] = text ? [{ type: 'text', text: text.replace(/\n/g, ' ') }] : [];
    return heading
      ? { type: 'heading', attrs: { level: heading[1]?.length ?? 1 }, content: inline }
      : { type: 'paragraph', content: inline };
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function inlineText(node: DocNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(inlineText).join('');
}

/** The inverse of {@link markdownToDoc}: headings and paragraphs, other blocks as plain text. */
export function docToMarkdown(doc: DocNode): string {
  return (doc.content ?? [])
    .map((block) => {
      const text = inlineText(block);
      if (block.type === 'heading') {
        const level = typeof block.attrs?.level === 'number' ? block.attrs.level : 1;
        return `${'#'.repeat(Math.min(Math.max(level, 1), 3))} ${text}`;
      }
      return text;
    })
    .filter((text) => text !== '')
    .join('\n\n');
}
