import { describe, expect, it } from 'vitest';
import { BasicMarkdownCodec } from './markdown-codec';

describe('BasicMarkdownCodec byte order marks', () => {
  it('ignores a leading byte order mark before frontmatter', () => {
    const bom = String.fromCharCode(0xfeff);
    const { doc, frontmatter } = new BasicMarkdownCodec().parse(`${bom}---\ntitle: X\n---\n# Heading`);
    expect(frontmatter).toEqual({ title: 'X' });
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });
});
