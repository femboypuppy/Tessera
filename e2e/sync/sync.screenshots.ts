import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import {
  createLocalWorkspace,
  createPage,
  enableDebugHooks,
  expect,
  joinWorkspace,
  pageTree,
  signIn,
  syncStatus,
  test,
  uploadWorkspace,
  workspaceIdOf,
} from './fixtures';

/** `pnpm screenshots e2e/sync` writes the sync screenshots used by the docs and README. */
const OUT = fileURLToPath(new URL('../../assets/screenshots/sync/', import.meta.url));

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function writeDoc(page: Page, pageId: string, json: unknown): Promise<void> {
  await page.waitForFunction(() => window.__tesseraSync !== undefined);
  await page.evaluate(([id, doc]) => window.__tesseraSync?.writeDocJSON(id, doc), [
    pageId,
    json,
  ] as const);
}

const text = (value: string) => ({ type: 'text', text: value });
const p = (value: string) => ({ type: 'paragraph', content: [text(value)] });
const h = (level: number, value: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const task = (checked: boolean, value: string) => ({
  type: 'taskItem',
  attrs: { checked },
  content: [p(value)],
});

const launchPlanV1 = {
  type: 'doc',
  content: [
    h(1, 'Launch plan'),
    p('Apollo 11 lifts off from Launch Complex 39A. This page tracks the go/no-go poll.'),
    {
      type: 'taskList',
      content: [task(true, 'Weather briefing'), task(false, 'Range safety check')],
    },
  ],
};
const launchPlanV2 = {
  type: 'doc',
  content: [
    h(1, 'Launch plan'),
    p(
      'Apollo 11 lifts off from Launch Complex 39A at 09:32 EDT. This page tracks the go/no-go poll.',
    ),
    h(2, 'Go/no-go poll'),
    {
      type: 'taskList',
      content: [
        task(true, 'Weather briefing: go'),
        task(true, 'Range safety check: go'),
        task(false, 'Flight director final poll'),
      ],
    },
    {
      type: 'blockquote',
      content: [p('“We are go for launch.” Launch control, T-minus 3 minutes.')],
    },
  ],
};

test('sync screenshots', async ({ browser, page, context, syncServer, baseURL }) => {
  test.setTimeout(240_000);
  const origin = new URL(baseURL ?? '').origin;
  const ada = { email: 'ada@example.com', password: 'analytical engine' };

  // Connect: the connect flow's last step, with workspaces on the server to choose from.
  await signIn(context, syncServer, origin, ada);
  for (const name of ['Mission control', 'Design reviews']) {
    await context.request.post(`${syncServer.url}/api/workspaces`, {
      data: { name },
      headers: { origin },
    });
  }
  await createLocalWorkspace(page, 'Apollo research');
  const planId = await createPage(page, 'Launch plan');
  for (const title of [
    'Crew roster',
    'Lunar module checklist',
    'Reading list',
    'Mission timeline',
  ]) {
    await createPage(page, title);
  }
  await writeDoc(page, planId, launchPlanV1);
  await page.goto('/settings/sync');
  await page.getByRole('button', { name: 'Connect to a server' }).click();
  await page.getByLabel('Server address').fill(syncServer.url);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Upload and sync' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Design reviews' })).toBeVisible();
  await page.mouse.move(1400, 880);
  await snap(page, 'connect-server');

  // Upload, then the status popover of a synced workspace.
  await page.getByRole('button', { name: 'Upload and sync' }).click();
  await expect(syncStatus(page)).toHaveAttribute('data-sync-status', 'synced', { timeout: 15_000 });
  await page.goto(`/p/${planId}`);
  await expect(syncStatus(page)).toHaveAttribute('data-sync-status', 'synced', { timeout: 15_000 });
  await syncStatus(page).click();
  await expect(page.getByRole('dialog').getByText('Last sync')).toBeVisible();
  await snap(page, 'sync-status');
  await page.keyboard.press('Escape');

  // Presence: Grace opens the same page from her own browser.
  const graceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await enableDebugHooks(graceContext);
  await signIn(graceContext, syncServer, origin, {
    email: 'grace@example.com',
    password: 'compiler pioneer',
    name: 'Grace Hopper',
  });
  const invite = await context.request.post(
    `${syncServer.url}/api/workspaces/${await workspaceIdOf(page)}/invites`,
    { data: { role: 'editor' }, headers: { origin } },
  );
  const { token } = (await invite.json()) as { token: string };
  await graceContext.request.post(`${syncServer.url}/api/invites/${token}/accept`, {
    headers: { origin },
  });
  const grace = await graceContext.newPage();
  await joinWorkspace(grace, syncServer, 'Apollo research');
  await expect(pageTree(grace).getByRole('treeitem', { name: 'Launch plan' })).toBeVisible();
  await grace.goto(`/p/${planId}`);
  const presence = page.getByTestId('presence');
  await expect(presence).toHaveAccessibleName(/Grace Hopper/);
  await presence.click();
  await expect(page.getByRole('dialog').getByText('Grace Hopper')).toBeVisible();
  await snap(page, 'presence');
  await page.keyboard.press('Escape');

  // History: a saved version, later edits, and a preview of the first version.
  await page.getByRole('button', { name: 'Version history' }).click();
  const panel = page.getByRole('complementary', { name: 'Version history' });
  await panel.getByRole('button', { name: 'Save version' }).click();
  await panel.getByLabel('Name (optional)').fill('First outline');
  await panel.getByRole('button', { name: 'Save version' }).click();
  await expect(panel.getByText('First outline')).toBeVisible();
  await writeDoc(grace, planId, launchPlanV2);
  await expect(page.getByRole('button', { name: 'Version history' })).toBeVisible();
  await panel.getByRole('button', { name: 'Save version' }).click();
  await panel.getByLabel('Name (optional)').fill('Go/no-go poll added');
  await panel.getByRole('button', { name: 'Save version' }).click();
  await expect(panel.getByText('Go/no-go poll added')).toBeVisible();
  await panel.getByRole('button', { name: /First outline/ }).click();
  await expect(panel.getByRole('region', { name: 'Preview' })).toContainText('Weather briefing');
  // Let the confirmation toasts go before the picture.
  await expect(page.getByText('Version saved')).toHaveCount(0, { timeout: 15_000 });
  await page.mouse.move(1400, 880);
  await snap(page, 'history-panel');

  await graceContext.close();
});
