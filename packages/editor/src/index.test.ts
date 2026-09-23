import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { SCHEMA_DESCRIPTION, tesseraSchema } from '@tessera/core';
import { EDITOR_PACKAGE } from './index';

describe('@tessera/editor skeleton', () => {
  it('has TipTap and the canonical schema contract available', () => {
    expect(EDITOR_PACKAGE).toBe('@tessera/editor');
    expect(typeof Editor).toBe('function');
    expect(Object.keys(SCHEMA_DESCRIPTION.nodes)).toContain('pageLink');
    expect(tesseraSchema.nodes.paragraph).toBeDefined();
  });
});
