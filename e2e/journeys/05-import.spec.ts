/**
 * Journey 5: importing. From the first-run screen, import a markdown vault (a generated one: nested
 * pages, wikilinks, tags, tasks, tables and a CSV database) and find its pages in the sidebar.
 */
import { generateWorkspace } from '../../packages/testkit/src/generator';
import { expect, test, writeZip } from '../support';

test('import a markdown vault from the first-run screen', async ({ page, app }) => {
  const vault = generateWorkspace({
    seed: 'import-journey',
    pages: 18,
    databases: 1,
    rowsPerDatabase: 6,
    folder: 'Space notes',
  });
  const archive = writeZip(vault.markdownFiles());
  const topLevel = vault.pages.filter((entry) => entry.parentId === null && entry.role === 'page');

  await test.step('the first-run screen offers an import', async () => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Create an empty workspace' })).toBeVisible();
    const importAction = page
      .getByRole('button', { name: /import/i })
      .filter({ hasText: /markdown|obsidian/i })
      .first();
    if ((await importAction.count()) === 0) {
      // The import feature registers its onboarding action; without it there is nothing to test.
      await app.createWorkspace('Import check');
      await app.expectFeatures('import');
    }
    await importAction.click();
  });

  await test.step('the vault is chosen and imported', async () => {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await dialog
      .getByRole('button', { name: /choose|browse|select/i })
      .first()
      .click();
    await (await chooser).setFiles(archive);
    await dialog
      .getByRole('button', { name: /^import/i })
      .last()
      .click();
    await expect(dialog).toContainText(/imported/i, { timeout: 30_000 });
    // The report counts every page it created: the notes, the database and its rows, and the
    // import's root page. (It shows each label, then its number.)
    const rows = vault.pages.filter((entry) => entry.role === 'row').length;
    await expect(dialog).toContainText(new RegExp(`Pages\\s*${vault.pages.length + 1}(?!\\d)`));
    await expect(dialog).toContainText(/Databases\s*1(?!\d)/);
    await expect(dialog).toContainText(new RegExp(`Rows\\s*${rows}(?!\\d)`));
    await dialog
      .getByRole('button', { name: /done|close|open/i })
      .first()
      .click();
  });

  await test.step('the imported pages are in the sidebar under one new page', async () => {
    const root = app
      .pageTree()
      .getByRole('treeitem', { level: 1 })
      .filter({ hasText: /import|space notes/i })
      .first();
    await expect(root).toBeVisible();
    await root.focus();
    await page.keyboard.press('ArrowRight');
    for (const entry of topLevel.slice(0, 3)) {
      await expect(
        app.pageTree().getByRole('treeitem', { name: entry.title, exact: true }),
      ).toBeVisible();
    }
  });
});
