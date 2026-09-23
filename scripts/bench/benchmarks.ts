/**
 * The benchmarks. Each opens the seeded harness (the real app with a generated workspace, see
 * packages/testkit/harness) in a fresh Chromium context and measures in the page. Features that
 * aren't registered yet make their benchmark report "skipped" with the reason.
 */
import type { Browser, Page } from '@playwright/test';
import type { GenerateOptions } from '../../packages/testkit/src/generator';
import type { HarnessState } from '../../packages/testkit/src/harness-state';
import {
  describeMissing,
  missingFeatures,
  readDiagnostics,
  type FeatureName,
} from '../../packages/testkit/src/playwright/features';
import type { HarnessServer } from '../../packages/testkit/src/playwright/harness-server';
import type { BenchResult } from './report.ts';
import { median, percentile } from './stats.ts';

export interface BenchContext {
  browser: Browser;
  harness: HarnessServer;
  /** Repetitions for benchmarks that reload the app. */
  runs: number;
  log(message: string): void;
}

export type BenchOutcome = Omit<BenchResult, 'id' | 'title' | 'budget' | 'withinBudget'>;

/** What the harness publishes as `window.__tesseraHarness` (the import brings its global type). */
export type Harness = HarnessState;

export interface Benchmark {
  id: string;
  title: string;
  budget?: { max: number; label: string };
  run(context: BenchContext): Promise<BenchOutcome>;
}

const skipped = (reason: string): BenchOutcome => ({ status: 'skipped', reason });

/**
 * tsx compiles with esbuild's `keepNames`, which wraps named functions in `__name(…)` calls, and
 * the functions passed to `page.evaluate` are sent as source text. The page needs the helper too.
 */
export const KEEP_NAMES_SHIM = 'globalThis.__name = (target) => target;';

/** Opens the harness with a generated workspace and waits for an interactive sidebar. */
async function openHarness(
  context: BenchContext,
  options: GenerateOptions,
): Promise<{ page: Page; close(): Promise<void> }> {
  const browserContext = await context.browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await browserContext.addInitScript(KEEP_NAMES_SHIM);
  const page = await browserContext.newPage();
  await page.goto(context.harness.url(options));
  await page.waitForFunction(
    () => window.__tesseraHarness?.ready === true || Boolean(window.__tesseraHarness?.error),
    null,
    { timeout: 180_000 },
  );
  const error = await page.evaluate(() => window.__tesseraHarness?.error ?? null);
  if (error) throw new Error(`The harness failed to start: ${error}`);
  return { page, close: () => browserContext.close() };
}

/** Why the benchmark can't run in this build, or null when every feature is there. */
async function missing(page: Page, required: FeatureName[]): Promise<string | null> {
  const diagnostics = await readDiagnostics(page);
  if (!diagnostics) return 'no workspace opened';
  const absent = missingFeatures(diagnostics, required);
  return absent.length ? describeMissing(absent) : null;
}

const WORKSPACE_5000: GenerateOptions = { seed: 42, pages: 5000 };

export const BENCHMARKS: readonly Benchmark[] = [
  {
    id: 'cold-start',
    title: 'Cold start, 5,000 pages → interactive sidebar',
    budget: { max: 2000, label: 'SPEC.md §10: < 2 s to an interactive sidebar' },
    async run(context) {
      const boot: number[] = [];
      const navigation: number[] = [];
      let pages = 0;
      for (let run = 0; run < context.runs; run += 1) {
        const { page, close } = await openHarness(context, WORKSPACE_5000);
        const state = await page.evaluate(() => {
          const harness = window.__tesseraHarness;
          return { timings: harness?.timings, pages: harness?.pages.length ?? 0 };
        });
        await close();
        if (!state.timings?.sidebarReady) throw new Error('No sidebar timing');
        boot.push(state.timings.sidebarReady - state.timings.seeded);
        navigation.push(state.timings.sidebarReady);
        pages = state.pages;
        context.log(`  run ${run + 1}: ${Math.round(boot.at(-1) ?? 0)} ms`);
      }
      return {
        status: 'ok',
        value: median(boot),
        unit: 'ms',
        measure: `median of ${boot.length} runs`,
        details: {
          'pages (with databases and rows)': String(pages),
          'since navigation, including generating the workspace': median(navigation),
        },
      };
    },
  },
  {
    id: 'search',
    title: 'Search, 5,000 pages: query p95',
    budget: { max: 50, label: 'SPEC.md §10: < 50 ms p95 per query' },
    async run(context) {
      const { page, close } = await openHarness(context, WORKSPACE_5000);
      try {
        const titles = await page.evaluate(
          () => window.__tesseraHarness?.pages.map((entry) => entry.title) ?? [],
        );
        const words = [
          ...new Set(
            titles
              .flatMap((title) => title.split(/\s+/))
              .filter((word) => /^[A-Za-z]{5,}$/.test(word)),
          ),
        ];
        const queries = [
          ...words.slice(0, 25),
          ...titles.slice(0, 15).map((title) => title.split(/\s+/).slice(0, 2).join(' ')),
          ...words.slice(25, 35).map((word) => word.slice(0, 3)),
          ...[
            '#space',
            '#engineering',
            '#recipes',
            '#travel',
            'launch window',
            'sourdough starter',
            'rate limiter',
            'pollinator',
            'Lisbon',
            'telemetry',
          ],
        ];
        const implementation = (await readDiagnostics(page))?.services.searchIndex ?? 'unknown';
        const measured = await page.evaluate(async (list) => {
          const ctx = window.__tesseraHarness?.ctx;
          if (!ctx) throw new Error('No workspace context');
          const index = ctx.services.searchIndex;
          const warmStart = performance.now();
          if (index.rebuild) await index.rebuild();
          else await index.query('warm up', { limit: 1 });
          const warm = performance.now() - warmStart;
          const times: number[] = [];
          for (const query of list) {
            const started = performance.now();
            await index.query(query, { limit: 20 });
            times.push(performance.now() - started);
          }
          return { warm, times };
        }, queries);
        return {
          status: 'ok',
          value: percentile(measured.times, 95),
          unit: 'ms',
          measure: `p95 of ${measured.times.length} queries`,
          details: {
            implementation,
            p50: percentile(measured.times, 50),
            'indexing all pages first': measured.warm,
          },
        };
      } finally {
        await close();
      }
    },
  },
  {
    id: 'palette',
    title: 'Command palette: keystroke → results p95',
    budget: { max: 50, label: 'SPEC.md §10: palette < 50 ms p95 per keystroke' },
    async run(context) {
      const { page, close } = await openHarness(context, WORKSPACE_5000);
      try {
        const reason = await missing(page, ['search']);
        if (reason) return skipped(reason);
        await page.keyboard.press('ControlOrMeta+K');
        await page.getByRole('dialog').first().waitFor();
        await page.evaluate(() => {
          const samples: number[] = [];
          (window as unknown as { __paletteLatency: number[] }).__paletteLatency = samples;
          let pending: number | null = null;
          document.addEventListener('keydown', (event) => (pending = event.timeStamp), {
            capture: true,
          });
          new MutationObserver(() => {
            if (pending === null) return;
            samples.push(performance.now() - pending);
            pending = null;
          }).observe(document.querySelector('[role="dialog"]') ?? document.body, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        });
        await page.keyboard.type('mission control launch window', { delay: 150 });
        const samples = await page.evaluate(
          () => (window as unknown as { __paletteLatency: number[] }).__paletteLatency,
        );
        return {
          status: 'ok',
          value: percentile(samples, 95),
          unit: 'ms',
          measure: `p95 of ${samples.length} keystrokes`,
        };
      } finally {
        await close();
      }
    },
  },
  {
    id: 'open-large-page',
    title: 'Open a 2,000-block page',
    async run(context) {
      const times: number[] = [];
      for (let run = 0; run < context.runs; run += 1) {
        const { page, close } = await openHarness(context, {
          seed: 42,
          pages: 200,
          largePages: [2000],
        });
        try {
          const reason = await missing(page, ['editor']);
          if (reason) return skipped(reason);
          const large = await page.evaluate(() => window.__tesseraHarness?.largePages[0] ?? null);
          if (!large) throw new Error('No large page');
          times.push(
            await page.evaluate(async ({ id, marker }) => {
              const ctx = window.__tesseraHarness?.ctx;
              if (!ctx) throw new Error('No workspace context');
              const started = performance.now();
              ctx.navigate(id);
              await new Promise<void>((resolve, reject) => {
                const check = () => {
                  const editors = [...document.querySelectorAll('main [contenteditable="true"]')];
                  if (editors.some((element) => element.textContent?.includes(marker))) resolve();
                  else if (performance.now() - started > 60_000)
                    reject(new Error('The page body did not render'));
                  else requestAnimationFrame(check);
                };
                check();
              });
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => setTimeout(resolve, 0)),
              );
              return performance.now() - started;
            }, large),
          );
        } finally {
          await close();
        }
      }
      return {
        status: 'ok',
        value: median(times),
        unit: 'ms',
        measure: `median of ${times.length} runs`,
      };
    },
  },
  {
    id: 'typing',
    title: 'Typing on a 2,000-block page: keystroke → next frame p95',
    budget: { max: 16, label: 'SPEC.md §10: < 16 ms p95' },
    async run(context) {
      const { page, close } = await openHarness(context, {
        seed: 42,
        pages: 200,
        largePages: [2000],
      });
      try {
        const reason = await missing(page, ['editor']);
        if (reason) return skipped(reason);
        const large = await page.evaluate(() => window.__tesseraHarness?.largePages[0] ?? null);
        if (!large) throw new Error('No large page');
        await page.evaluate((id) => window.__tesseraHarness?.ctx?.navigate(id), large.id);
        const body = page.locator('main [contenteditable="true"]').first();
        await body.getByText(large.marker).waitFor({ timeout: 60_000 });
        await body.locator('p').nth(1000).click();
        await page.keyboard.press('End');
        await page.evaluate(() => {
          const samples: number[] = [];
          (window as unknown as { __typingLatency: number[] }).__typingLatency = samples;
          document.addEventListener(
            'keydown',
            (event) => {
              const pressed = event.timeStamp;
              requestAnimationFrame(() => {
                const channel = new MessageChannel();
                channel.port1.onmessage = () => samples.push(performance.now() - pressed);
                channel.port2.postMessage(null);
              });
            },
            { capture: true },
          );
        });
        await page.keyboard.type(
          ' The quick brown fox jumps over the lazy dog while the engines hum.',
          { delay: 40 },
        );
        const samples = await page.evaluate(
          () => (window as unknown as { __typingLatency: number[] }).__typingLatency,
        );
        return {
          status: 'ok',
          value: percentile(samples, 95),
          unit: 'ms',
          measure: `p95 of ${samples.length} keystrokes`,
          details: { p50: percentile(samples, 50) },
        };
      } finally {
        await close();
      }
    },
  },
  {
    id: 'graph',
    title: 'Graph view, 5,000 pages: frame time p95',
    budget: { max: 33.4, label: 'SPEC.md §10: fluid (≥ 30 fps)' },
    async run(context) {
      const { page, close } = await openHarness(context, WORKSPACE_5000);
      try {
        const reason = await missing(page, ['graph']);
        if (reason) return skipped(reason);
        const measured = await page.evaluate(async () => {
          const ctx = window.__tesseraHarness?.ctx;
          if (!ctx) throw new Error('No workspace context');
          const started = performance.now();
          ctx.navigateTo('/graph');
          await new Promise<void>((resolve, reject) => {
            const check = () => {
              if (document.querySelector('main canvas')) resolve();
              else if (performance.now() - started > 60_000) reject(new Error('No graph canvas'));
              else requestAnimationFrame(check);
            };
            check();
          });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const firstRender = performance.now() - started;
          const frames: number[] = [];
          let last = performance.now();
          await new Promise<void>((resolve) => {
            const tick = (now: number) => {
              frames.push(now - last);
              last = now;
              if (now - started - firstRender < 3000) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
          return { firstRender, frames };
        });
        return {
          status: 'ok',
          value: percentile(measured.frames, 95),
          unit: 'ms',
          measure: `p95 of ${measured.frames.length} frames`,
          details: { 'first render': measured.firstRender },
        };
      } finally {
        await close();
      }
    },
  },
  {
    id: 'import',
    title: 'Import 2,000 markdown files: longest main-thread block',
    budget: { max: 100, label: 'SPEC.md §10: without freezing the UI (no task over 100 ms)' },
    async run(context) {
      const { page, close } = await openHarness(context, {
        seed: 'import',
        pages: 1990,
        databases: 3,
        rowsPerDatabase: 20,
      });
      try {
        const measured = await page.evaluate(async () => {
          const harness = window.__tesseraHarness;
          const ctx = harness?.ctx;
          if (!harness || !ctx) throw new Error('No workspace context');
          const encoder = new TextEncoder();
          const files = harness.markdownFiles().map((file) => {
            const bytes = encoder.encode(file.content);
            return {
              path: file.path,
              size: bytes.byteLength,
              text: async () => file.content,
              bytes: async () => bytes,
            };
          });
          const [best] = await ctx.importers.detect(files);
          if (!best) return { error: 'No importer recognized the markdown files' } as const;
          const longTasks: number[] = [];
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
          });
          observer.observe({ type: 'longtask' });
          const started = performance.now();
          const report = await best.importer.run(
            files,
            {
              workspace: ctx.workspace,
              loadPageDoc: (id) => ctx.loadPageDoc(id),
              loadDatabaseDoc: (id) => ctx.loadDatabaseDoc(id),
              assets: ctx.services.assetStore,
              codec: ctx.services.markdownCodec,
              parentId: null,
              rootTitle: 'Benchmark import',
              currentUser: ctx.currentUser,
            },
            () => undefined,
            new AbortController().signal,
          );
          const duration = performance.now() - started;
          await new Promise((resolve) => setTimeout(resolve, 200));
          observer.disconnect();
          return {
            importer: best.importer.id,
            files: files.length,
            pages: report.counts.pages,
            duration,
            longest: Math.max(0, ...longTasks),
            longTasks: longTasks.length,
          };
        });
        if ('error' in measured) return { status: 'failed', reason: measured.error };
        return {
          status: 'ok',
          value: measured.longest,
          unit: 'ms',
          measure: `${measured.longTasks} long tasks`,
          details: {
            importer: measured.importer,
            files: String(measured.files),
            'pages created': String(measured.pages),
            'total time': measured.duration,
          },
        };
      } finally {
        await close();
      }
    },
  },
];
