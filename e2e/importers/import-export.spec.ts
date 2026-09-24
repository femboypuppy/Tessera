import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  createWorkspace,
  expandTreeItem,
  fixturePath,
  folderEntries,
  importFolder,
  openFromTree,
  pageTree,
  readZip,
  sidebar,
  writeZip,
} from './helpers';

test.describe('import', () => {
  test('imports an Obsidian vault through the dialog and follows its links', async ({ page }) => {
    // The PDF export opens the print dialog; record the call instead of blocking the browser.
    await page.addInitScript(() => {
      const state = window as unknown as { printed: number };
      state.printed = 0;
      window.print = () => {
        state.printed += 1;
      };
    });
    await createWorkspace(page, 'Research');
    const dialog = await importFolder(page, 'obsidian-vault', { rootTitle: 'Apollo vault' });

    // The preview: detected source, what is inside, what is skipped.
    await expect(dialog.getByText('Detected', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Source' })).toHaveText(/Obsidian/);
    const preview = dialog.getByRole('region', { name: 'Files to import' });
    await expect(preview).toContainText('11 notes');
    await expect(preview).toContainText('1 database');
    await expect(preview).toContainText('4 attachments');
    await expect(
      preview.getByRole('listitem').filter({ hasText: /^Projects3 items$/ }),
    ).toBeVisible();
    await expect(dialog.getByText(/files? (is|are) skipped/)).toBeVisible();

    await dialog.getByRole('button', { name: /^Import \d+ files$/ }).click();

    // The report.
    const report = page.getByRole('dialog', { name: 'Import complete' });
    await expect(report).toBeVisible({ timeout: 30_000 });
    const counts = report.getByTestId('import-counts');
    for (const [label, value] of [
      ['Pages', '25'],
      ['Databases', '1'],
      ['Rows', '4'],
      ['Attachments', '4'],
      ['Links', '23'],
      ['Skipped files', '3'],
    ])
      await expect(counts.getByTestId(`count-${label}`)).toHaveText(`${label}${value}`);
    const brokenLinks = report.getByText('Links to pages that were not in the import');
    await expect(brokenLinks).toBeVisible();
    await brokenLinks.click();
    await expect(report.getByText(/Missing mission/)).toBeVisible();

    await report.getByRole('button', { name: 'Open imported pages' }).click();
    await expect(report).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Apollo vault');

    // The imported tree.
    await expandTreeItem(page, 'Apollo vault');
    for (const title of ['Projects', 'Welcome', 'Reading list', 'Café crème ☕', 'Daily'])
      await expect(
        pageTree(page).getByRole('treeitem', { name: title, exact: true }),
      ).toBeVisible();

    // Follow links through the print view (the PDF export).
    await openFromTree(page, 'Welcome');
    await page.getByRole('button', { name: 'Export page' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export' });
    await exportDialog.getByRole('radio', { name: /^PDF/ }).click();
    await exportDialog.getByRole('button', { name: 'Open print view' }).click();
    const printed = page.getByTestId('print-page');
    await expect(printed.getByRole('heading', { level: 1 })).toHaveText('Welcome');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
      .toBe(1);
    await printed.getByRole('link', { name: 'Apollo 11', exact: true }).click();
    await expect(printed.getByRole('heading', { level: 1 })).toHaveText('Apollo 11 🚀');
    await expect(printed).toContainText('Crew: Armstrong, Aldrin, Collins.');
    // The alias link resolves to the note that declares it.
    await printed.getByRole('link', { name: 'home page' }).click();
    await expect(printed.getByRole('heading', { level: 1 })).toHaveText('Welcome');
    await printed.getByRole('link', { name: 'countdown' }).click();
    await expect(printed.getByRole('heading', { level: 1 })).toHaveText('Launch plan');
    await page.getByRole('button', { name: 'Back to page' }).click();
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Launch plan');
    await expect(sidebar(page)).toBeVisible();
  });
});

test.describe('drop', () => {
  test('imports a Notion export zip dropped on the dialog', async ({ page }) => {
    await createWorkspace(page, 'From Notion');
    await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import' });
    const zip = writeZip(folderEntries(fixturePath('notion-export')));
    const dropZone = dialog.getByTestId('import-drop-zone');
    const transfer = await page.evaluateHandle(
      (bytes) => {
        const data = new DataTransfer();
        data.items.add(
          new File([new Uint8Array(bytes)], 'Export-5b1c2d3e-8f4a-4c1b-9d2e-7a6b5c4d3e2f.zip', {
            type: 'application/zip',
          }),
        );
        return data;
      },
      [...zip],
    );
    await dropZone.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(dropZone).toHaveAttribute('data-dropping', 'true');
    await expect(dialog.getByText('Drop to import')).toBeVisible();
    await dropZone.dispatchEvent('dragover', { dataTransfer: transfer });
    await dropZone.dispatchEvent('drop', { dataTransfer: transfer });

    // Detected as Notion; the page is named for Notion, not for the archive.
    await expect(dialog.getByRole('combobox', { name: 'Source' })).toHaveText(/Notion/);
    await expect(dialog.getByLabel('New page for the import')).toHaveValue('Notion import');
    await expect(dialog.getByRole('region', { name: 'Files to import' })).toContainText(
      '2 databases',
    );
    await dialog.getByRole('button', { name: /^Import \d+ files$/ }).click();
    const report = page.getByRole('dialog', { name: 'Import complete' });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report.getByTestId('count-Databases')).toHaveText('Databases2');
    await report.getByRole('button', { name: 'Open imported pages' }).click();
    await expandTreeItem(page, 'Notion import');
    // Notion's IDs are gone from the titles.
    await expect(
      pageTree(page).getByRole('treeitem', { name: 'Workspace Home', exact: true }),
    ).toBeVisible();
  });
});

test.describe('export', () => {
  test('exports the workspace as a zip of Obsidian markdown', async ({ page }) => {
    await createWorkspace(page, 'Library');
    const dialog = await importFolder(page, 'markdown-folder', { rootTitle: 'Library' });
    await dialog.getByRole('button', { name: /^Import \d+ files$/ }).click();
    const report = page.getByRole('dialog', { name: 'Import complete' });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await report.getByRole('button', { name: 'Close' }).click();
    await expect(report).toBeHidden();

    await sidebar(page).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Import & export' }).click();
    await page.getByRole('button', { name: 'Export workspace as markdown' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export' });
    await expect(exportDialog.getByRole('radio', { name: /^Markdown \(zip\)/ })).toBeChecked();
    await expect(exportDialog.getByRole('radio', { name: /^The whole workspace/ })).toBeChecked();
    const download = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Library.zip');
    await expect(page.getByRole('dialog', { name: 'Export ready' })).toBeVisible();

    const zip = readZip(await readFile(await file.path()));
    const names = [...zip.keys()].sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'Library.md',
        'Library/Books.csv',
        'Library/Books/Dune.md',
        'Library/Guides/Getting started.md',
        'Library/README.md',
        'Library/Reference/Glossary.md',
        'attachments/cover.png',
      ]),
    );
    const csv = zip.get('Library/Books.csv')?.toString('utf8') ?? '';
    expect(csv.split('\n')[0]).toContain('Title');
    const guide = zip.get('Library/Guides/Getting started.md')?.toString('utf8') ?? '';
    expect(guide).toMatch(/\[\[[^\]]+\]\]/);
  });
});
