import { expect, test, type Page } from '@playwright/test';
import { newPage, openPalette, openWorkspace, seed, whenIndexed } from './helpers';

interface GraphHooks {
  nodePosition(id: string): { x: number; y: number } | null;
  settled(): boolean;
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __tesseraGraph?: GraphHooks }).__tesseraGraph?.settled() === true,
    undefined,
    { timeout: 60_000 },
  );
}

async function nodePosition(page: Page, id: string): Promise<{ x: number; y: number }> {
  const position = await page.evaluate(
    (nodeId) =>
      (window as unknown as { __tesseraGraph?: GraphHooks }).__tesseraGraph?.nodePosition(nodeId) ??
      null,
    id,
  );
  if (!position) throw new Error(`node ${id} is not in the graph`);
  return position;
}

async function openGraph(page: Page): Promise<void> {
  await openPalette(page);
  await page.keyboard.type('>graph view');
  await page.keyboard.press('Enter');
}

test.describe('graph view', () => {
  test('renders the workspace and opens a page when its node is clicked', async ({ page }) => {
    await openWorkspace(page);
    const pages = await seed(page, 60, 5);
    await openGraph(page);
    const graph = page.getByRole('img', { name: /Graph view: 60 pages/ });
    await expect(graph).toBeVisible();
    await expect(graph.locator('canvas').first()).toBeVisible();
    await settled(page);
    await expect(
      page.getByRole('status').filter({ hasText: /60 pages · \d+ links/ }),
    ).toBeVisible();
    const target = pages.find((entry) => entry.title === 'Europa');
    if (!target) throw new Error('no Europa page');
    const { x, y } = await nodePosition(page, target.id);
    await page.mouse.click(x, y);
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Europa');
  });

  test('the search box focuses a page, and Enter opens it', async ({ page }) => {
    await openWorkspace(page);
    await seed(page, 60, 5);
    await openGraph(page);
    await settled(page);
    const search = page.getByRole('combobox', { name: 'Find a page in the graph' });
    await search.fill('tita');
    await expect(page.getByRole('option', { name: 'Titan', exact: true })).toBeVisible();
    await search.press('Enter');
    await expect(page.getByText('Focused on Titan')).toBeVisible();
    await search.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Titan');
  });

  test('filters hide orphans and limit depth around the focused page', async ({ page }) => {
    await openWorkspace(page);
    await seed(page, 60, 5);
    await newPage(page, 'A lonely page');
    await whenIndexed(page);
    await openGraph(page);
    await settled(page);
    const stats = page.getByRole('status').filter({ hasText: /pages · \d+ links/ });
    const pagesShown = async () =>
      Number(/(\d+) pages/.exec((await stats.textContent()) ?? '')?.[1]);
    await expect(stats).toContainText('61 pages');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('switch', { name: 'Orphans' }).click();
    // The new page and any other page without links disappear.
    await expect.poll(pagesShown).toBeLessThan(61);
    await page.keyboard.press('Escape');
    const withoutOrphans = await pagesShown();
    const search = page.getByRole('combobox', { name: 'Find a page in the graph' });
    await search.fill('lonely');
    await expect(page.getByText('No page matches')).toBeVisible();
    await search.fill('');

    await search.fill('Europa');
    await page.getByRole('option', { name: 'Europa', exact: true }).click();
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('combobox', { name: 'Depth' }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    await page.keyboard.press('Escape');
    await settled(page);
    const count = await pagesShown();
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThan(withoutOrphans);
  });

  test('the local graph shows the page and its neighbors', async ({ page }) => {
    await openWorkspace(page);
    const pages = await seed(page, 60, 5);
    await openPalette(page);
    await page.keyboard.type('europa');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Europa');
    await page.getByRole('button', { name: 'Local graph', exact: true }).first().click();
    const local = page.getByRole('img', { name: /Local graph: \d+ pages/ });
    await expect(local).toBeVisible();
    await settled(page);
    const depth1 = Number(/(\d+) pages/.exec((await local.getAttribute('aria-label')) ?? '')?.[1]);
    await page.getByLabel('Depth 1').fill('2');
    await expect(page.getByText('Depth 2')).toBeVisible();
    await expect
      .poll(async () =>
        Number(/(\d+) pages/.exec((await local.getAttribute('aria-label')) ?? '')?.[1]),
      )
      .toBeGreaterThan(depth1);
    // Clicking a neighbor opens it.
    await settled(page);
    const neighbor = await page.evaluate(
      (ids) => {
        const hooks = (window as unknown as { __tesseraGraph?: GraphHooks }).__tesseraGraph;
        return ids.find((id) => hooks?.nodePosition(id)) ?? null;
      },
      pages.filter((entry) => entry.title !== 'Europa').map((entry) => entry.id),
    );
    if (!neighbor) throw new Error('no neighbor in the local graph');
    const { x, y } = await nodePosition(page, neighbor);
    await page.mouse.click(x, y);
    await expect(page.getByRole('textbox', { name: 'Page title' })).not.toHaveValue('Europa');
  });
});
