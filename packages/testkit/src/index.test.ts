import { indexPages, listPages } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import * as testkit from './index';

describe('@tessera/testkit', () => {
  it('exports the generator and the runtime helpers from its entry point', () => {
    expect(typeof testkit.generateWorkspace).toBe('function');
    expect(typeof testkit.createSeededAppContext).toBe('function');
    expect(typeof testkit.seedFeature).toBe('function');
    expect(typeof testkit.GeneratedDocStore).toBe('function');
  });

  it('builds workspace docs through the core helpers', () => {
    const workspace = testkit.generateWorkspace({
      seed: 'entry',
      pages: 12,
      databases: 1,
      rowsPerDatabase: 2,
    });
    const ws = workspace.workspaceDoc();
    expect(
      listPages(ws)
        .map((page) => page.title)
        .sort(),
    ).toEqual(workspace.pages.map((page) => page.title).sort());
    expect(indexPages(ws).isRow(workspace.databases[0]?.rows[0]?.id ?? '')).toBe(true);
  });
});
