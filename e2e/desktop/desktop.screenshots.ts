import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createPage, pageTree } from '../architect/helpers';
import { HOME, useDesktop } from './fixtures';

/**
 * `pnpm screenshots e2e/desktop` writes the desktop screenshots (the production web build with the
 * desktop feature, Tauri mocked): desktop-window, workspace-picker, quick-capture and
 * desktop-settings, each in light and dark.
 */
const OUT = fileURLToPath(new URL('../../assets/screenshots/desktop/', import.meta.url));
const THEMES = ['light', 'dark'] as const;

async function quiet(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function setTheme(page: Page, colorScheme: (typeof THEMES)[number]): Promise<void> {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
}

async function snap(page: Page, name: string, prepare?: () => Promise<void>): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const colorScheme of THEMES) {
    await setTheme(page, colorScheme);
    await prepare?.();
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await setTheme(page, 'light');
}

async function setIcon(page: Page, pageTitle: string, search: string): Promise<void> {
  await pageTree(page).getByRole('treeitem', { name: pageTitle, exact: true }).click();
  await page.getByRole('textbox', { name: 'Page title' }).hover();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill(search);
  await expect(page.locator('button[data-emoji]').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Change icon' })).toBeVisible();
}

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 23, 9, 30);
const manifest = (id: string, name: string) => ({
  id,
  name,
  createdAt: now - 90 * day,
  formatVersion: 1,
});

/** Four workspaces: the open one, one in Dropbox, one never used yet, one on an unplugged drive. */
const REGISTRY = [
  {
    id: 'ws_apollo_research',
    name: 'Apollo research',
    path: `${HOME}/Tessera/Apollo research`,
    createdAt: now - 90 * day,
    lastOpenedAt: now,
    initializedAt: now - 90 * day,
  },
  {
    id: 'ws_team_notes',
    name: 'Team notes',
    icon: '🛰️',
    path: `${HOME}/Dropbox/Team notes`,
    createdAt: now - 60 * day,
    lastOpenedAt: now - 2 * day,
    initializedAt: now - 60 * day,
  },
  {
    id: 'ws_personal',
    name: 'Personal',
    icon: '🌱',
    path: `${HOME}/Tessera/Personal`,
    createdAt: now - 1 * day,
    lastOpenedAt: now - 1 * day,
  },
  {
    id: 'ws_field_trip',
    name: 'Field trip 2025',
    path: 'E:/Archive/Field trip 2025',
    createdAt: now - 400 * day,
    lastOpenedAt: now - 30 * day,
    initializedAt: now - 400 * day,
  },
];
const FOLDERS = {
  [`${HOME}/Tessera/Apollo research`]: {
    workspace: manifest('ws_apollo_research', 'Apollo research'),
  },
  [`${HOME}/Dropbox/Team notes`]: { workspace: manifest('ws_team_notes', 'Team notes') },
};

test('desktop screenshots', async ({ page, context }) => {
  await useDesktop(page, { registry: REGISTRY, folders: FOLDERS });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toContainText(
    'Apollo research',
  );

  for (const title of [
    'Apollo program',
    'Mission control',
    'Lunar module checklist',
    'Reading list',
    'Launch plan',
    'Team handbook',
  ]) {
    await createPage(page, title);
  }
  const tree = pageTree(page);
  for (const child of ['Mission control', 'Lunar module checklist']) {
    await tree.getByRole('treeitem', { name: child, exact: true }).focus();
    await page.keyboard.press('Alt+Shift+ArrowRight');
  }
  await setIcon(page, 'Reading list', 'books');
  await setIcon(page, 'Team handbook', 'compass');
  await setIcon(page, 'Launch plan', 'calendar');
  await page.getByRole('button', { name: 'Add to favorites' }).click();

  // A thought captured earlier from the quick-capture window.
  const capture = await context.newPage();
  await useDesktop(capture, { windowLabel: 'capture' });
  await capture.setViewportSize({ width: 600, height: 300 });
  await capture.goto('/capture');
  const field = capture.getByRole('textbox', { name: 'Quick capture' });
  await field.fill('Ask Margaret about the rendezvous radar timing');
  await field.press('Enter');
  await expect(capture.getByText('Added to Inbox')).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'Inbox' })).toBeVisible();

  await setIcon(page, 'Apollo program', 'rocket');
  await page.getByRole('textbox', { name: 'Page title' }).hover();
  await page.getByRole('button', { name: 'Add cover' }).click();
  await page.getByRole('button', { name: 'Change cover' }).hover();
  await page.getByRole('button', { name: 'Change cover' }).click();
  await page.getByRole('button', { name: 'aurora', exact: true }).click();
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await quiet(page);
  await snap(page, 'desktop-window');

  // The workspace picker (File → Open workspace…, Ctrl+O).
  await page.keyboard.press('ControlOrMeta+o');
  const picker = page.getByRole('dialog', { name: 'Workspaces' });
  await expect(picker.getByText('Synced by Dropbox')).toBeVisible();
  await expect(picker.getByText('Folder not found')).toBeVisible();
  await quiet(page);
  await snap(page, 'workspace-picker');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);

  // Quick capture: the small always-on-top window over the app, as on screen. The shortcut shows
  // the window again (Rust emits `desktop://capture-shown`), then a new note is typed.
  await capture.evaluate(() =>
    (window as unknown as { __fakeTauri: { emit(event: string): void } }).__fakeTauri.emit(
      'desktop://capture-shown',
    ),
  );
  await expect(capture.getByRole('button', { name: 'Add to Inbox' })).toBeVisible();
  await field.fill('Book the vacuum chamber for Thursday\n[ ] send the test plan to Gene');
  const shots: Record<string, { app: string; capture: string }> = {};
  for (const colorScheme of THEMES) {
    await setTheme(page, colorScheme);
    await setTheme(capture, colorScheme);
    await quiet(page);
    await field.focus();
    const app = (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString(
      'base64',
    );
    const window = (await capture.screenshot({ animations: 'disabled' })).toString('base64');
    shots[colorScheme] = { app, capture: window };
  }
  const composite = await context.newPage();
  await composite.setViewportSize({ width: 1440, height: 900 });
  for (const colorScheme of THEMES) {
    const shot = shots[colorScheme];
    if (!shot) continue;
    await composite.setContent(`<!doctype html>
      <style>
        html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
        .app { position: absolute; inset: 0; width: 1440px; height: 900px; filter: brightness(${colorScheme === 'dark' ? 0.7 : 0.82}) saturate(0.9); }
        .window { position: absolute; left: 420px; top: 250px; width: 600px; height: 300px; border-radius: 10px; overflow: hidden;
          box-shadow: 0 24px 64px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.12); }
      </style>
      <img class="app" src="data:image/png;base64,${shot.app}" alt="">
      <img class="window" src="data:image/png;base64,${shot.capture}" alt="">`);
    await composite.waitForFunction(() => [...document.images].every((image) => image.complete));
    mkdirSync(OUT, { recursive: true });
    await composite.screenshot({ path: `${OUT}quick-capture-${colorScheme}.png` });
  }
  await setTheme(page, 'light');

  // Settings → Desktop, with the markdown copy on.
  await page.goto('/settings/desktop');
  await page.getByRole('switch', { name: 'Keep a markdown copy of every page' }).click();
  await expect(page.getByText(/Updated .* · \d+ files/)).toBeVisible();
  await quiet(page);
  await snap(page, 'desktop-settings');
});
