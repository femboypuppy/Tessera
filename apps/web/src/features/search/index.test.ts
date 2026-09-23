import { COMMANDS, PANELS } from '@tessera/core';
import { createTestAppContext } from '@tessera/core/testing';
import { paletteStore } from '@tessera/search/palette-host';
import { describe, expect, it } from 'vitest';
import { backlinksFeature } from '../backlinks';
import { graphFeature } from '../graph';
import { searchFeature } from './index';

describe('search, graph and backlinks features', () => {
  it('register their indexes, commands, routes, panels and overlays', async () => {
    const test = await createTestAppContext({
      features: [searchFeature, graphFeature, backlinksFeature],
    });
    const { ctx } = test;
    // No workers in jsdom: the indexes run in-process, but they are still ours.
    expect(ctx.serviceSources).toMatchObject({ searchIndex: 'minisearch', linkIndex: 'graph' });
    expect(ctx.commands.get(COMMANDS.openPalette)?.shortcut).toBe('Mod+K');
    for (const id of [COMMANDS.search, COMMANDS.openGraph, 'backlinks.show', 'graph.showLocal']) {
      expect(ctx.commands.has(id)).toBe(true);
    }
    expect(
      ctx.contributions
        .list('routes')
        .map((route) => route.path)
        .sort(),
    ).toEqual(['/graph', '/search']);
    expect(ctx.contributions.list('pageSidePanels').map((panel) => panel.id)).toEqual([
      PANELS.backlinks,
      PANELS.localGraph,
    ]);
    expect(ctx.contributions.list('overlays').map((overlay) => overlay.id)).toEqual(['palette']);
    expect(ctx.contributions.list('sidebarSections').map((section) => section.id)).toEqual([
      'graph',
    ]);
    expect(ctx.contributions.list('pageFooterSections').map((section) => section.id)).toEqual([
      'backlinks',
    ]);
    expect(ctx.contributions.list('settingsPanels').map((panel) => panel.id)).toEqual([
      'backlinks',
    ]);
    await test.dispose();
  });

  it('opens the palette with its command and the search page with a query', async () => {
    const test = await createTestAppContext({ features: [searchFeature] });
    expect(await test.ctx.commands.execute(COMMANDS.openPalette)).toBe(true);
    expect(paletteStore.getState().open).toBe(true);
    expect(await test.ctx.commands.execute(COMMANDS.openPalette)).toBe(true);
    expect(paletteStore.getState().open).toBe(false);
    expect(await test.ctx.commands.execute(COMMANDS.search, { args: { query: '#space' } })).toBe(
      true,
    );
    expect(test.shell.navigations.at(-1)).toMatchObject({ path: '/search?q=%23space' });
    await test.dispose();
  });

  it('remembers recently opened pages', async () => {
    const test = await createTestAppContext({ features: [searchFeature] });
    const page = test.ctx.workspace.createPage({ title: 'Recent one' });
    test.ctx.events.emit('navigation.changed', { pageId: page.id, path: `/p/${page.id}` });
    expect(test.ctx.settings.device.get(`search.recent.${test.workspace.id}`)).toEqual([page.id]);
    await test.dispose();
  });

  it('opens the graph and the side panels from their commands', async () => {
    const test = await createTestAppContext({ features: [graphFeature, backlinksFeature] });
    expect(await test.ctx.commands.execute(COMMANDS.openGraph)).toBe(true);
    expect(test.shell.navigations.at(-1)).toMatchObject({ path: '/graph' });
    const page = test.ctx.workspace.createPage({ title: 'Open page' });
    test.shell.currentPageId = page.id;
    expect(await test.ctx.commands.execute('backlinks.show')).toBe(true);
    expect(await test.ctx.commands.execute('graph.showLocal')).toBe(true);
    expect(test.shell.panels).toEqual([PANELS.backlinks, PANELS.localGraph]);
    await test.dispose();
  });
});
