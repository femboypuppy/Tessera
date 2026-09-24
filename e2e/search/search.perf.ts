import { expect, test, type Page } from '@playwright/test';
import { openPalette, openWorkspace, palette, seed } from './helpers';

/** `pnpm exec playwright test -c e2e/search/perf.config.ts` (see perf.config.ts). */

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function report(label: string, samples: number[]): void {
  console.log(
    `${label.padEnd(36)} p50 ${percentile(samples, 50).toFixed(1)} ms · p95 ${percentile(samples, 95).toFixed(1)} ms · max ${Math.max(...samples).toFixed(1)} ms (${samples.length} samples)`,
  );
}

/**
 * Types each phrase one character at a time into the open palette and measures, for every
 * keystroke, the time from the input event until the palette rendered that text's results.
 */
async function measureKeystrokes(page: Page, phrases: string[]): Promise<number[]> {
  return page.evaluate(async (list) => {
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog?.querySelector<HTMLInputElement>('input[role="combobox"]');
    const box = dialog?.querySelector('[role="listbox"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!input || !box || !setter) throw new Error('the palette is not open');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const type = (value: string) =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        const timer = setTimeout(() => finish(5000), 5000);
        const observer = new MutationObserver(() => {
          if (box.getAttribute('data-query') === value.trim()) finish(performance.now() - start);
        });
        function finish(ms: number) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(ms);
        }
        observer.observe(box, { attributes: true, attributeFilter: ['data-query'] });
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const samples: number[] = [];
    for (const phrase of list) {
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await frame();
      await frame();
      for (let i = 1; i <= phrase.length; i += 1) {
        const value = phrase.slice(0, i);
        if (value.endsWith(' ')) continue;
        samples.push(await type(value));
      }
    }
    return samples;
  }, phrases);
}

test('palette keystrokes on 5,000 pages', async ({ page }) => {
  await openWorkspace(page, 'Performance');
  const started = Date.now();
  await seed(page, 5000, 42);
  console.log(`Seeded and indexed 5,000 pages in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await openPalette(page);
  const samples = await measureKeystrokes(page, [
    'andromeda galaxy',
    'kyoto itinerary',
    'sourdough',
    'transformers paper notes',
    'coral bleaching',
    'apollo program timeline',
    'offline sync spec',
    'europa',
    'mantis shrimp dive log',
    'hanseatic league',
  ]);
  report('Palette keystroke (5,000 pages)', samples);
  await expect(palette(page).getByRole('option').first()).toBeVisible();
  expect(percentile(samples, 95)).toBeLessThan(50);
});

test('graph with 10,000 nodes', async ({ page }) => {
  await openWorkspace(page, 'Performance');
  const size = await page.evaluate(() => {
    const hooks = window.__tesseraSearch;
    if (!hooks) throw new Error('search test hooks are not installed');
    return (
      hooks as unknown as { stressGraph(pages: number): { nodes: number; edges: number } }
    ).stressGraph(10_000);
  });
  console.log(`Synthetic graph: ${size.nodes} nodes, ${size.edges} edges`);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  console.log(`WebGL renderer: ${renderer}`);
  const started = Date.now();
  await openPalette(page);
  await page.keyboard.type('>graph view');
  await page.keyboard.press('Enter');
  const canvas = page.getByRole('img', { name: /Graph view: 10,000 pages/ });
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  console.log(`First render after ${((Date.now() - started) / 1000).toFixed(1)} s`);

  // Frame times while the layout runs (it runs in a worker, so the page must stay smooth).
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const record = () =>
    page.evaluate(() => {
      const state = window as unknown as { __frames?: number[]; __recording?: boolean };
      state.__frames = [];
      state.__recording = true;
      let last = performance.now();
      const loop = (time: number) => {
        state.__frames?.push(time - last);
        last = time;
        if (state.__recording) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  const stop = () =>
    page.evaluate(() => {
      const state = window as unknown as { __frames?: number[]; __recording?: boolean };
      state.__recording = false;
      return (state.__frames ?? []).slice(1);
    });
  const drag = async () => {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.move(x + Math.sin(i / 6) * 180, y + Math.cos(i / 9) * 120);
    }
    await page.mouse.up();
  };

  await record();
  await drag();
  report('Frame time, panning during layout', await stop());

  const layoutStarted = Date.now();
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __tesseraGraph?: { settled(): boolean } }
      ).__tesseraGraph?.settled() === true,
    undefined,
    { timeout: 5 * 60_000 },
  );
  console.log(`Layout settled after ${((Date.now() - layoutStarted) / 1000).toFixed(1)} s more`);

  await record();
  await drag();
  const settledFrames = await stop();
  report('Frame time, panning (settled)', settledFrames);

  await record();
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.move(box.x + (box.width * i) / 40, box.y + box.height / 2 + Math.sin(i) * 80);
  }
  report('Frame time, hovering (settled)', await stop());
  expect(percentile(settledFrames, 95)).toBeLessThan(100);
});
