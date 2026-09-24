import { afterEach, describe, expect, it } from 'vitest';
import { databaseOf, docOf, importWorkspace, linksOf, outline, pageAt } from '../test/helpers';
import type { TestAppContext } from '@tessera/core/testing';
import { loadDemoFiles, openDemo } from './demo';

describe('demo workspace', () => {
  let test: TestAppContext | null = null;
  afterEach(async () => {
    await test?.dispose();
    test = null;
  });

  it('bundles a markdown folder until examples/demo-workspace exists', async () => {
    const paths = (await loadDemoFiles()).map((file) => file.path).sort();
    expect(paths).toContain('Start here.md');
    expect(paths).toContain('Reading list.csv');
    expect(paths.every((path) => !path.startsWith('.') && !path.includes('../'))).toBe(true);
  });

  it('imports into the workspace and opens the welcome page', async () => {
    test = await importWorkspace();
    const { ctx, shell } = test;
    await openDemo(ctx);
    const [root] = ctx.workspace.pages.getSnapshot().children(null);
    expect(root?.title).toBe('Tessera demo');
    const rootId = root?.id ?? '';
    expect(outline(ctx, rootId)).toEqual([
      '🗓️ Meetings',
      '  2026-09-14 Kickoff',
      '  2026-09-21 Design review',
      '🗂️ Projects',
      '  📱 Mobile app',
      '  🚀 Website relaunch',
      'Reading list [database]',
      '  · The Design of Everyday Things',
      '  · Shape Up',
      '  · Working in Public',
      '  · Local-first software',
      '  · How to Take Smart Notes',
      '  · The Pragmatic Programmer',
      '👋 Start here',
      '✍️ Writing guide',
    ]);
    const start = pageAt(ctx, rootId, 'Start here');
    expect(shell.navigations.at(-1)).toEqual({ pageId: start.id });
    // Every link in the demo resolves.
    const links = linksOf(ctx, await docOf(ctx, start.id)).map((link) => link.title);
    expect(links).toEqual(
      expect.arrayContaining(['Website relaunch', '2026-09-14 Kickoff', 'Reading list']),
    );
    expect(shell.toasts).toEqual([]);
    const { properties, rows } = await databaseOf(ctx, pageAt(ctx, rootId, 'Reading list').id);
    expect(properties.map((property) => `${property.name}:${property.type}`)).toEqual([
      'Title:title',
      'Author:text',
      'Status:select',
      'Tags:multiSelect',
      'Rating:number',
      'Finished:checkbox',
      'Started:date',
      'Link:url',
    ]);
    expect(rows).toHaveLength(6);
  }, 60_000);
});
