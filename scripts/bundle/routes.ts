/**
 * JS per route: visits each screen of the production build in a fresh Chromium context and
 * records the chunks it requested. Idle-time preloads (the shell warms Trash and Settings when the
 * browser is idle) are held back during the visit, so each route is charged only what it needs.
 */
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';

export interface RouteVisit {
  label: string;
  route: string;
  /** Dist-relative chunk files (`assets/index-abc.js`), sorted. */
  files: string[];
}

/** Holds `requestIdleCallback` work until the page calls `__releaseIdle()` (never, here). */
const DEFER_IDLE = `(() => {
  const queue = [];
  window.requestIdleCallback = (callback) => queue.push(callback);
  window.cancelIdleCallback = () => undefined;
  window.__releaseIdle = () => queue.splice(0).forEach((callback) => callback({ didTimeout: false, timeRemaining: () => 50 }));
})();`;

async function createWorkspace(page: Page): Promise<void> {
  await page.getByLabel('Workspace name').fill('Bundle check');
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await page.getByText('Your workspace is empty').waitFor();
}

/** Client-side navigation (a reload would lose the in-memory workspace). */
async function navigate(page: Page, route: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
}

interface Step {
  label: string;
  route: string;
  run(page: Page): Promise<void>;
}

const SHELL_ROUTES: Step[] = [
  {
    label: 'Onboarding',
    route: '/',
    run: (page) => page.getByRole('button', { name: 'Create an empty workspace' }).waitFor(),
  },
  { label: 'Empty workspace', route: '/', run: createWorkspace },
  {
    label: 'Page',
    route: '/p/:pageId',
    async run(page) {
      await createWorkspace(page);
      await page
        .getByRole('navigation', { name: 'Sidebar' })
        .getByRole('button', { name: 'New page', exact: true })
        .first()
        .click();
      await page.getByRole('textbox', { name: 'Page title' }).waitFor();
    },
  },
  {
    label: 'Trash',
    route: '/trash',
    async run(page) {
      await createWorkspace(page);
      await page
        .getByRole('navigation', { name: 'Sidebar' })
        .getByRole('button', { name: 'Trash' })
        .click();
      await page.getByRole('heading', { name: 'Trash', level: 1 }).waitFor();
    },
  },
  {
    label: 'Settings',
    route: '/settings',
    async run(page) {
      await createWorkspace(page);
      await page
        .getByRole('navigation', { name: 'Sidebar' })
        .getByRole('button', { name: 'Settings' })
        .click();
      await page.getByRole('heading', { level: 1 }).first().waitFor();
    },
  },
  {
    label: 'Component gallery',
    route: '/dev/ui',
    async run(page) {
      await navigate(page, '/dev/ui');
      await page.getByRole('heading', { level: 1 }).first().waitFor();
    },
  },
];

/** Visits every shell route and every route a feature registers. */
export async function measureRoutes(webDir: string): Promise<RouteVisit[]> {
  const server = await preview({
    root: webDir,
    configFile: path.join(webDir, 'vite.config.ts'),
    logLevel: 'silent',
    preview: { port: 0, host: '127.0.0.1', strictPort: false },
  });
  const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
  if (!origin) throw new Error('The preview server has no URL');
  const browser = await chromium.launch();
  const visit = async (step: Step): Promise<RouteVisit> => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(DEFER_IDLE);
    // tsx's esbuild keepNames wraps named functions in __name(); evaluated functions need it too.
    await context.addInitScript('globalThis.__name = (target) => target;');
    const page = await context.newPage();
    const files = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        url.origin === origin &&
        url.pathname.startsWith('/assets/') &&
        url.pathname.endsWith('.js')
      ) {
        files.add(url.pathname.slice(1));
      }
    });
    try {
      await page.goto(`${origin}/`);
      await step.run(page);
      await page.waitForLoadState('networkidle');
      return { label: step.label, route: step.route, files: [...files].sort() };
    } finally {
      await context.close();
    }
  };
  try {
    const visits: RouteVisit[] = [];
    for (const step of SHELL_ROUTES) visits.push(await visit(step));
    // Feature routes, from the running app's diagnostics.
    const probe = await browser.newPage();
    await probe.goto(`${origin}/`);
    await createWorkspace(probe);
    const routes = await probe.evaluate(() => {
      const api = (
        window as unknown as {
          __tessera?: { diagnostics(): { contributions: Record<string, string[]> } };
        }
      ).__tessera;
      return api?.diagnostics().contributions.routes ?? [];
    });
    await probe.close();
    for (const route of routes.filter((candidate) => !candidate.includes(':'))) {
      visits.push(
        await visit({
          label: `Feature route ${route}`,
          route,
          async run(page) {
            await createWorkspace(page);
            await navigate(page, route);
          },
        }),
      );
    }
    return visits;
  } finally {
    await browser.close();
    await server.close();
  }
}
