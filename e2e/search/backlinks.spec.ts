import { expect, test, type Page } from '@playwright/test';
import { newPage, openWorkspace, whenIndexed, write } from './helpers';

function tree(page: Page) {
  return page.getByRole('navigation', { name: 'Sidebar' }).getByRole('tree', { name: 'Pages' });
}

async function openBacklinks(page: Page) {
  await page.getByRole('button', { name: 'Backlinks', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Backlinks' });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('backlinks', () => {
  test('a new link shows up as a backlink with its context', async ({ page }) => {
    await openWorkspace(page);
    const target = await newPage(page, 'Apollo program');
    const source = await newPage(page, 'Mission notes');
    await tree(page).getByRole('treeitem', { name: 'Apollo program' }).click();
    const panel = await openBacklinks(page);
    await expect(panel.getByText('No pages link here yet')).toBeVisible();

    // Create the link in the other page: the open panel updates on its own.
    await write(page, source, [['We followed the ', { link: target }, ' closely.']]);
    await expect(panel.getByRole('button', { name: 'Mission notes' })).toBeVisible();
    const context = panel.getByRole('button', { name: /We followed the Apollo program closely/ });
    await expect(context).toBeVisible();
    await expect(context.locator('mark')).toHaveText('Apollo program');

    // Renaming the target updates the context (titles are live).
    await page.getByRole('textbox', { name: 'Page title' }).fill('Project Apollo');
    const renamed = panel.getByRole('button', { name: /We followed the Project Apollo closely/ });
    await expect(renamed).toBeVisible();

    // The context opens the source page.
    await renamed.click();
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Mission notes');
  });

  test('links an unlinked mention with one click, and undoes it', async ({ page }) => {
    await openWorkspace(page);
    const target = await newPage(page, 'Europa');
    const source = await newPage(page, 'Moons of Jupiter');
    await write(page, source, [['The ocean under Europa may be warm; europa is icy.']]);
    await write(page, target, [['An icy moon.']], { aliases: ['Jupiter II'] });
    await tree(page).getByRole('treeitem', { name: 'Europa', exact: true }).click();
    const panel = await openBacklinks(page);
    const mentions = panel.getByRole('region', { name: /Unlinked mentions/ });
    await expect(mentions.getByRole('button', { name: /Link this mention of Europa/ })).toHaveCount(
      2,
    );
    await expect(mentions.locator('mark').first()).toHaveText('Europa');

    await mentions
      .getByRole('button', { name: 'Link this mention of Europa in Moons of Jupiter' })
      .first()
      .click();
    await expect(page.getByText('Linked “Europa” in Moons of Jupiter').first()).toBeVisible();
    await whenIndexed(page);
    const references = panel.getByRole('region', { name: /Linked references/ });
    await expect(references.getByRole('button', { name: 'Moons of Jupiter' })).toBeVisible();
    await expect(mentions.getByRole('button', { name: /Link this mention of Europa/ })).toHaveCount(
      1,
    );
    const doc = JSON.stringify(
      await page.evaluate((id) => window.__tesseraSearch?.readDoc(id), source),
    );
    expect(doc).toContain(`"pageId":"${target}"`);

    // Undo puts the text back.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(async () =>
        JSON.stringify(await page.evaluate((id) => window.__tesseraSearch?.readDoc(id), source)),
      )
      .not.toContain(`"pageId":"${target}"`);
    await expect(mentions.getByRole('button', { name: /Link this mention of Europa/ })).toHaveCount(
      2,
    );
  });

  test('shows the optional footer under pages when the setting is on', async ({ page }) => {
    await openWorkspace(page);
    const target = await newPage(page, 'Launch plan');
    const source = await newPage(page, 'Weekly review');
    await write(page, source, [['Check the ', { link: target }, ' dates.']]);
    await tree(page).getByRole('treeitem', { name: 'Launch plan' }).click();
    await expect(page.getByTestId('backlinks-footer')).toHaveCount(0);
    const panel = await openBacklinks(page);
    await panel.getByRole('switch', { name: 'Show backlinks at the bottom of pages' }).click();
    const footer = page.getByTestId('backlinks-footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByRole('button', { name: '1 backlink' })).toBeVisible();
    await expect(footer.getByRole('button', { name: /Weekly review/ })).toContainText(
      'Check the Launch plan dates.',
    );
    await footer.getByRole('button', { name: /Weekly review/ }).click();
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Weekly review');
  });
});
