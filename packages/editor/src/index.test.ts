import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { EDITOR_PACKAGE } from './index';

describe('@tessera/editor skeleton', () => {
  it('has TipTap available', () => {
    expect(EDITOR_PACKAGE).toBe('@tessera/editor');
    expect(typeof Editor).toBe('function');
  });
});
