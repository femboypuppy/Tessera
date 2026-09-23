/**
 * The testkit's Playwright fixtures work against the real app: a fresh workspace, a seeded
 * workspace (5,000 pages open fast), and a running server.
 */
import { expect, test } from '../support';

test.describe('fixtures', () => {
  test('freshWorkspace opens an empty workspace with diagnostics', async ({
    freshWorkspace: app,
  }) => {
    const diagnostics = await app.diagnostics();
    expect(diagnostics.features).toContain('editor');
    expect(diagnostics.commands).toContain('shell.newPage');
    await app.newPage('Fixture check');
    await expect(app.treeItem('Fixture check')).toBeVisible();
  });

  test.describe('seededWorkspace', () => {
    test.use({
      seedOptions: { seed: 5, pages: 150, databases: 3, rowsPerDatabase: 6, trashed: 2 },
    });

    test('shows the generated tree, favorites and trash', async ({
      seededWorkspace: { app, state },
      page,
    }) => {
      const favorites = app
        .sidebar()
        .getByRole('region')
        .filter({ has: page.getByRole('button', { name: 'Favorites' }) });
      await expect(favorites.getByRole('button', { name: 'Project tracker' })).toBeVisible();
      const topLevel = state.pages.filter(
        (entry) => entry.parentId === null && entry.role !== 'row',
      );
      await expect(app.pageTree().getByRole('treeitem', { level: 1 })).toHaveCount(topLevel.length);
      await expect(app.treeItem(topLevel[0]?.title ?? '')).toBeVisible();

      const nested = state.pages.find(
        (entry) =>
          entry.depth === 1 &&
          entry.role === 'page' &&
          !entry.trashed &&
          entry.parentId === topLevel[0]?.id,
      );
      if (nested) {
        await app.treeItem(topLevel[0]?.title ?? '').focus();
        await page.keyboard.press('ArrowRight');
        await expect(app.treeItem(nested.title)).toBeVisible();
        await app.openPage(nested.title);
      }

      await app.sidebar().getByRole('button', { name: 'Trash' }).click();
      await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
      for (const trashed of state.pages.filter((entry) => entry.trashed)) {
        await expect(page.getByText(trashed.title, { exact: true })).toBeVisible();
      }
    });
  });

  test.describe('a large seeded workspace', () => {
    test.use({ seedOptions: { seed: 42, pages: 5000 } });

    test('opens 5,000 pages with an interactive sidebar', async ({
      seededWorkspace: { state, app },
    }) => {
      expect(state.pages.length).toBeGreaterThan(5000);
      const coldStart = (state.timings.sidebarReady ?? Infinity) - state.timings.seeded;
      test.info().annotations.push({ type: 'cold start (ms)', description: coldStart.toFixed(0) });
      // scripts/bench measures the 2 s budget on a production build; on the dev server this only
      // checks that 5,000 pages open in reasonable time.
      expect(coldStart).toBeLessThan(15_000);
      await expect(app.pageTree().getByRole('treeitem').first()).toBeVisible();
    });
  });

  test('syncServer runs a real server on a free port', async ({ syncServer }) => {
    const response = await fetch(`${syncServer.url}/api/health`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
