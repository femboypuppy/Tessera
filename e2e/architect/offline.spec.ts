import { expect, test } from '@playwright/test';
import { createPage, createWorkspace, pageTree } from './helpers';

// The only spec with the service worker on (playwright.config.ts blocks it elsewhere).
test.use({ serviceWorkers: 'allow' });

test('starts offline after one visit: the app, the editor and the pages', async ({
  page,
  context,
}) => {
  await createWorkspace(page, 'Field notes');
  await createPage(page, 'Offline notes');
  await page.getByRole('textbox', { name: 'Page title' }).press('Enter');
  await page.keyboard.type('Written before the flight.');
  const body = page.getByRole('main').locator('[contenteditable="true"]').first();
  await expect(body).toContainText('Written before the flight.');

  // The service worker cached this build (every file, the editor's included) and controls the page.
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 60_000,
    })
    .toBe(true);
  const cached = await page.evaluate(async () => {
    const [name] = await caches.keys();
    return name ? (await (await caches.open(name)).keys()).length : 0;
  });
  expect(cached).toBeGreaterThan(50);

  await context.setOffline(true);
  try {
    await page.reload();
    const tree = pageTree(page);
    await expect(tree.getByRole('treeitem', { name: 'Offline notes' })).toBeVisible();
    await tree.getByRole('treeitem', { name: 'Offline notes' }).click();
    await expect(body).toContainText('Written before the flight.');
    // Still editable offline.
    await body.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' And after.');
    await expect(body).toContainText('And after.');
  } finally {
    await context.setOffline(false);
  }
});
