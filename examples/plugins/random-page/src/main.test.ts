import { createTestHarness } from '@tessera/plugin-api/testing';
import { describe, expect, it } from 'vitest';
import plugin, { pickRandomPage } from './main';

const permissions = ['pages:read', 'ui:commands'] as const;

describe('pickRandomPage', () => {
  const page = (
    id: string,
    patch: Partial<{ kind: 'page' | 'database'; trashed: boolean }> = {},
  ) => ({
    id,
    title: id,
    icon: null,
    kind: patch.kind ?? ('page' as const),
    parentId: null,
    createdAt: 0,
    updatedAt: 0,
    isRow: false,
    trashed: patch.trashed ?? false,
  });
  const pages = [
    page('a'),
    page('b'),
    page('db', { kind: 'database' }),
    page('gone', { trashed: true }),
  ];

  it('never picks the current page, trashed pages or (optionally) databases', () => {
    const picks = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      picks.add(
        pickRandomPage(pages, { exclude: 'a', includeDatabases: false }, () => i / 100)?.id ?? '',
      );
    }
    expect([...picks]).toEqual(['b']);
    expect(pickRandomPage(pages, { exclude: 'a', includeDatabases: true }, () => 0.99)?.id).toBe(
      'db',
    );
  });

  it('spreads picks over every candidate', () => {
    const seen = new Set<string>();
    for (const value of [0, 0.34, 0.67, 0.999])
      seen.add(
        pickRandomPage(pages, { exclude: null, includeDatabases: true }, () => value)?.id ?? '',
      );
    expect(seen).toEqual(new Set(['a', 'b', 'db']));
    expect(pickRandomPage([], { exclude: null, includeDatabases: true })).toBeNull();
  });
});

describe('Random page command', () => {
  it('opens another page', async () => {
    const harness = createTestHarness(plugin, {
      permissions,
      pages: [
        { id: 'apollo', title: 'Apollo program' },
        { id: 'gemini', title: 'Gemini program' },
      ],
      currentPageId: 'apollo',
    });
    await harness.activate();
    expect(harness.commands.map((command) => command.title)).toEqual(['Open a random page']);
    // From Apollo it can only go to Gemini; from there, only back to Apollo.
    for (let i = 0; i < 5; i += 1) await harness.runCommand('open-random', { pageId: 'apollo' });
    expect(new Set(harness.openedPages)).toEqual(new Set(['gemini']));
    await harness.runCommand('open-random');
    expect(harness.openedPages.at(-1)).toBe('apollo');
  });

  it('says so when there is nothing else to open', async () => {
    const harness = createTestHarness(plugin, {
      permissions,
      pages: [{ id: 'only', title: 'Only page' }],
      currentPageId: 'only',
    });
    await harness.activate();
    await harness.runCommand('open-random');
    expect(harness.openedPages).toEqual([]);
    expect(harness.notifications).toEqual([{ title: 'There’s no other page to open yet.' }]);
  });

  it('explains a missing permission', async () => {
    const harness = createTestHarness(plugin, { permissions: ['ui:commands'] });
    await harness.activate();
    await harness.runCommand('open-random');
    expect(harness.notifications[0]).toMatchObject({
      title: 'Couldn’t open a random page',
      variant: 'error',
    });
  });
});
