import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createPage, listPages } from '@tessera/core';
import { TESTKIT_PACKAGE } from './index';

describe('@tessera/testkit skeleton', () => {
  it('builds workspace docs through the core helpers', () => {
    expect(TESTKIT_PACKAGE).toBe('@tessera/testkit');
    const ws = new Y.Doc();
    createPage(ws, { title: 'Seed' });
    expect(listPages(ws).map((page) => page.title)).toEqual(['Seed']);
  });
});
