import { expect, test } from '@playwright/test';
import { createPage, createWorkspace, pageTree } from '../architect/helpers';
import {
  ensureExamplesBuilt,
  expectCommand,
  FIXTURE_BASE,
  installFromRegistry,
  installFromUrl,
  openPluginSettings,
  pluginFrame,
  serveFixtures,
  serveRegistry,
} from './support';

test.beforeAll(async () => {
  // The first run builds the example plugins (Mermaid takes a while).
  test.setTimeout(600_000);
  await ensureExamplesBuilt();
});

test('plugin code runs only in sandboxed frames with a strict CSP', async ({ page }) => {
  await serveRegistry(page);
  await createWorkspace(page, 'Sandbox');
  await createPage(page, 'Isolation');
  await openPluginSettings(page);
  await installFromRegistry(page, 'Word count');
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 20_000 });
  await pageTree(page).getByRole('treeitem', { name: 'Isolation' }).click();
  await page.getByRole('button', { name: 'Word count', exact: true }).click();
  await expect(pluginFrame(page, 'Word count panel').getByTestId('word-count')).toBeVisible();

  const frames = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-plugin-frame]')].map((frame) => ({
      kind: frame.getAttribute('data-plugin-frame'),
      sandbox: frame.getAttribute('sandbox'),
      csp: /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(frame.srcdoc)?.[1] ?? '',
      // An opaque origin: the app can't reach into the frame, and so the frame can't reach out.
      readableByApp: (() => {
        try {
          return frame.contentDocument !== null;
        } catch {
          return false;
        }
      })(),
    })),
  );
  expect(frames.map((frame) => frame.kind).sort()).toEqual(['ui', 'worker']);
  for (const frame of frames) {
    expect(frame.sandbox).toBe('allow-scripts');
    expect(frame.readableByApp).toBe(false);
    expect(frame.csp).toContain("default-src 'none'");
    expect(frame.csp).toContain("connect-src 'none'");
    expect(frame.csp).toContain("frame-src 'none'");
    expect(frame.csp).toContain("form-action 'none'");
    expect(frame.csp).toMatch(/script-src 'nonce-[A-Za-z0-9]+' blob:/);
    expect(frame.csp).not.toContain('unsafe-eval');
  }
});

test('a plugin stuck in an infinite loop is stopped while the app stays responsive', async ({
  page,
}) => {
  await serveFixtures(page);
  await createWorkspace(page, 'Watchdog');
  await openPluginSettings(page);
  await installFromUrl(page, `${FIXTURE_BASE}spinner/manifest.json`, 'Spinner');
  await expectCommand(page, 'plugins.spinner/spin');

  await createPage(page, 'Before the loop');
  await page.keyboard.press('ControlOrMeta+Alt+Shift+KeyY');

  // While the plugin's worker spins, the app keeps working.
  const started = Date.now();
  await createPage(page, 'Still responsive');
  expect(Date.now() - started).toBeLessThan(4_000);

  await expect(
    page.getByText('Spinner stopped responding and was stopped.', { exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expectCommand(page, 'plugins.spinner/spin', false);
  await openPluginSettings(page);
  await page.getByRole('button', { name: 'Details for Spinner' }).click();
  await expect(page.getByText('Spinner stopped', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Console/ }).click();
  await expect(page.getByRole('log').getByText('Spinning now')).toBeVisible();

  // It can be restarted.
  await page.getByRole('button', { name: 'Restart' }).click();
  await expectCommand(page, 'plugins.spinner/spin');
});
