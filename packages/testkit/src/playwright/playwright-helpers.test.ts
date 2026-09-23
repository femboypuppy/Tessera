import { COMMANDS, PANELS } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { optionsFromSearch } from '../../harness/params';
import { describeMissing, missingFeatures, type Diagnostics } from './features';
import { harnessSearch } from './harness-server';

const skeleton: Diagnostics = {
  version: 1,
  workspaceId: 'w',
  features: [
    'editor',
    'sync',
    'databases',
    'search',
    'graph',
    'backlinks',
    'plugins',
    'import-export',
    'desktop',
  ],
  failedFeatures: [],
  services: { docStore: 'memory', workspaceRegistry: 'memory', searchIndex: 'naive' },
  contributions: { pageBodies: [], routes: [], pageSidePanels: [], settingsPanels: [] },
  commands: ['shell.newPage'],
  blockKinds: [],
};

describe('feature detection', () => {
  it('reports every feature as missing in the skeleton', () => {
    expect(missingFeatures(skeleton, ['editor', 'search', 'sync', 'import'])).toEqual([
      'editor',
      'search',
      'sync',
      'import',
    ]);
  });

  it('recognizes merged features from their contributions, commands and services', () => {
    const merged: Diagnostics = {
      ...skeleton,
      services: {
        docStore: 'indexeddb',
        workspaceRegistry: 'indexeddb',
        searchIndex: 'minisearch',
      },
      contributions: {
        pageBodies: ['page', 'database'],
        routes: ['/search', '/graph'],
        pageSidePanels: [PANELS.backlinks],
        settingsPanels: ['plugins'],
      },
      commands: [COMMANDS.openPalette, COMMANDS.openImport, COMMANDS.openExport],
    };
    expect(
      missingFeatures(merged, [
        'editor',
        'databases',
        'search',
        'graph',
        'backlinks',
        'import',
        'export',
        'persistence',
        'sync',
        'plugins',
      ]),
    ).toEqual([]);
  });

  it('explains what is missing and who builds it', () => {
    expect(describeMissing(['editor', 'search'])).toBe(
      'Needs the page editor (pageBodies.page), from Agent 02 (editor); the command palette (search.openPalette), from Agent 05 (search). Not registered in this build yet: runs once the feature is merged.',
    );
  });
});

describe('harness URLs', () => {
  it('round-trip generator options through the query string', () => {
    const options = {
      seed: 42,
      pages: 5000,
      databases: 2,
      rowsPerDatabase: 30,
      trashed: 3,
      maxDepth: 4,
      linksPerPage: 2.5,
      largePages: [2000, 500],
    };
    expect(optionsFromSearch(harnessSearch(options))).toEqual(options);
    expect(harnessSearch({})).toBe('');
    expect(optionsFromSearch('?seed=demo&pages=-3&large=x,10')).toEqual({
      seed: 'demo',
      largePages: [10],
    });
  });
});
