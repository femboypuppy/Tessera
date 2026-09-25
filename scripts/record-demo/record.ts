/**
 * Records the README demo (agents/12-polish.md §5): a scripted ~20-second tour of the demo
 * workspace at 1280×720 in Chromium, typed with human-like delays: a new page, the slash menu,
 * a `[[link]]`, dragging a card on the project board, and the graph. Playwright records the
 * video; ffmpeg turns it into `assets/demo.mp4` and an optimized `assets/demo.gif` (palette
 * generation, at most 8 MB).
 *
 *   pnpm record-demo [--url http://localhost:4173] [--out assets] [--keep]
 *
 * Without `--url` it builds the web app and serves it with `vite preview` on a free port.
 * `--keep` leaves the raw recording in `node_modules/.cache/record-demo`. Needs ffmpeg on PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Locator, type Page } from '@playwright/test';
import { serveApp } from '../lib/serve-app.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string', default: path.join(root, 'assets') },
    keep: { type: 'boolean', default: false },
  },
});

const VIEWPORT = { width: 1280, height: 720 };
const MAX_GIF_BYTES = 8 * 1024 * 1024;
const cache = path.join(root, 'node_modules', '.cache', 'record-demo');
mkdirSync(cache, { recursive: true });
// A folder per run: a video from an earlier run may still be locked for a moment on Windows.
const work = mkdtempSync(path.join(cache, 'run-'));

const log = (message: string) => console.info(message);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A visible mouse pointer: videos don't show the real one, and a card moving by itself on the
 * board would be confusing. A string, not a function: tsx wraps functions with a helper that
 * doesn't exist in the page.
 */
const POINTER_SCRIPT = `(() => {
  const pointer = document.createElement('div');
  pointer.setAttribute('aria-hidden', 'true');
  pointer.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.3 1.5L9.5 19z" fill="#1f1e1d" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(pointer.style, {
    position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
    transform: 'translate(-100px, -100px)', filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.25))',
  });
  const place = (event) => {
    pointer.style.transform = 'translate(' + (event.clientX - 4) + 'px, ' + (event.clientY - 2) + 'px)';
  };
  document.addEventListener('mousemove', place, true);
  document.addEventListener('pointermove', place, true);
  const attach = () => document.documentElement.appendChild(pointer);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();`;

/** Types like a person: a little uneven, a touch slower after spaces and punctuation. */
async function typeLikeAPerson(page: Page, text: string): Promise<void> {
  for (const character of text) {
    await page.keyboard.type(character);
    const pause = /[\s.,:]/.test(character) ? 75 : 36;
    await sleep(pause + Math.round(Math.random() * 35));
  }
}

/** Waits until keyboard focus is in the element with this accessible name. */
async function focusIn(page: Page, label: string): Promise<void> {
  await page.waitForFunction(
    (name) => document.activeElement?.closest(`[aria-label="${name}"]`) !== null,
    label,
  );
}

/** Glides the pointer to the middle of an element, then clicks it. */
async function glideAndClick(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The element to click is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  await sleep(120);
  await page.mouse.down();
  await page.mouse.up();
}

async function record(appUrl: string): Promise<{ video: string; start: number; end: number }> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    recordVideo: { dir: work, size: VIEWPORT },
  });
  await context.addInitScript({ content: POINTER_SCRIPT });

  // Set up off camera: the demo workspace, opened once (it stays in this profile's storage).
  const setup = await context.newPage();
  await setup.goto(appUrl);
  await setup.getByRole('button', { name: /Open the demo workspace/ }).click();
  await setup
    .getByRole('textbox', { name: 'Page title' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  // The graph, the palette and the editor's chunks are warm before the take.
  await setup
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Graph view' })
    .click();
  await setup.getByRole('img', { name: /Graph view: \d+ pages/ }).waitFor({ timeout: 60_000 });
  await setup
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('treeitem', { name: 'Welcome to Tessera', exact: true })
    .click();
  await sleep(1500);
  await setup.close();

  const page = await context.newPage();
  const opened = Date.now();
  await page.goto(appUrl);
  const title = page.getByRole('textbox', { name: 'Page title' });
  const body = page.getByRole('textbox', { name: 'Page content' });
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  await title.waitFor({ state: 'visible', timeout: 60_000 });
  await body.waitFor({ state: 'visible' });
  await page.mouse.move(860, 420);
  await sleep(900);
  const start = Date.now() - opened;

  // A new page, with a title and a first line.
  await glideAndClick(page, sidebar.getByRole('button', { name: 'New page', exact: true }).first());
  await focusIn(page, 'Page title');
  await sleep(250);
  await typeLikeAPerson(page, 'Opening night');
  await page.keyboard.press('Enter');
  await focusIn(page, 'Page content');
  await sleep(200);
  await typeLikeAPerson(page, 'Doors open at seven. Start at the ');

  // A link to another page, picked from the [[ menu.
  await typeLikeAPerson(page, '[[apollo 1');
  await page.getByRole('listbox', { name: /link to a page/i }).waitFor();
  await sleep(700);
  await page.keyboard.press('Enter');
  // The link leaves a space after itself.
  await typeLikeAPerson(page, 'wall.');
  await page.keyboard.press('Enter');

  // The slash menu: a to-do list.
  await typeLikeAPerson(page, '/to-do');
  await page.getByRole('listbox', { name: 'Insert a block' }).waitFor();
  await sleep(600);
  await page.keyboard.press('Enter');
  await typeLikeAPerson(page, 'Test the Saturn V lighting');
  await sleep(700);

  // The project board: drag a card to the next column.
  await glideAndClick(page, sidebar.getByRole('treeitem', { name: 'Projects', exact: true }));
  const card = page.getByRole('button', {
    name: 'Launch-window countdown for the simulator',
    exact: true,
  });
  await card.waitFor();
  await sleep(500);
  const from = await card.boundingBox();
  const column = page.locator('section[data-group-key]').nth(1);
  const to = await column.boundingBox();
  if (!from || !to) throw new Error('The board is not on screen');
  await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 24 });
  await sleep(200);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 26, { steps: 6 });
  await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 40 });
  await sleep(250);
  await page.mouse.up();
  await sleep(900);

  // The graph of the knowledge garden: find a page, and the view flies to it.
  await glideAndClick(page, sidebar.getByRole('button', { name: 'Graph view' }));
  await page.getByRole('img', { name: /Graph view: \d+ pages/ }).waitFor();
  await sleep(1200);
  await glideAndClick(page, page.getByRole('combobox', { name: 'Find a page in the graph' }));
  await typeLikeAPerson(page, 'apollo 11');
  await page.getByRole('option', { name: 'Apollo 11', exact: true }).waitFor();
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.mouse.move(VIEWPORT.width / 2 + 60, VIEWPORT.height / 2 + 40, { steps: 30 });
  await sleep(1800);
  const end = Date.now() - opened;

  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();
  const file = await video?.path();
  if (!file) throw new Error('Playwright did not record a video');
  return { video: file, start, end };
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
}

/** MP4 (H.264, streams as it loads) and a GIF made with its own palette, under 8 MB. */
function convert(recording: { video: string; start: number; end: number }): void {
  mkdirSync(values.out, { recursive: true });
  const from = Math.max(0, recording.start / 1000 - 0.2);
  const length = (recording.end - recording.start) / 1000 + 0.4;
  const trim = ['-ss', from.toFixed(2), '-t', length.toFixed(2), '-i', recording.video];
  const mp4 = path.join(values.out, 'demo.mp4');
  ffmpeg([
    ...trim,
    '-vf',
    'fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ]);
  log(`${path.relative(root, mp4)}: ${(statSync(mp4).size / 1e6).toFixed(1)} MB`);

  const gif = path.join(values.out, 'demo.gif');
  const palette = path.join(work, 'palette.png');
  // Smaller and slower until it fits: 1024 px at 15 fps first.
  for (const [width, fps] of [
    [1024, 15],
    [960, 12],
    [800, 12],
    [800, 10],
  ] as const) {
    const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
    ffmpeg([...trim, '-vf', `${scale},palettegen=max_colors=128:stats_mode=diff`, palette]);
    ffmpeg([
      ...trim,
      '-i',
      palette,
      '-lavfi',
      `${scale}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
      '-loop',
      '0',
      gif,
    ]);
    const size = statSync(gif).size;
    log(`${path.relative(root, gif)}: ${width} px at ${fps} fps, ${(size / 1e6).toFixed(1)} MB`);
    if (size <= MAX_GIF_BYTES) return;
  }
  throw new Error('The GIF is over 8 MB even at 800 px and 10 fps');
}

const app = await serveApp(values.url);
try {
  log(`Recording the demo from ${app.url}…`);
  const recording = await record(app.url);
  log(`Recorded ${((recording.end - recording.start) / 1000).toFixed(1)} s of demo; converting…`);
  convert(recording);
} finally {
  app.stop();
  if (values.keep) log(`The raw recording is in ${path.relative(root, work)}`);
  else {
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      log(`Could not remove ${work} (${String(error)}); it is only a cache.`);
    }
  }
}
