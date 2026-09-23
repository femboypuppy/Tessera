import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { MARKDOWN_PACKAGE } from './index';

describe('@tessera/markdown skeleton', () => {
  it('parses GFM with unified', () => {
    expect(MARKDOWN_PACKAGE).toBe('@tessera/markdown');
    const tree = unified().use(remarkParse).use(remarkGfm).parse('| a |\n| - |\n| b |');
    expect(tree.children[0]?.type).toBe('table');
  });
});
