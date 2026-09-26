/**
 * Screenshots of the built docs site, in both themes, at 1440×900:
 *
 *   pnpm --dir docs screenshots     (builds the site first)
 *
 * Serves `docs/.vitepress/dist` under the site's base path with a tiny static server, then writes
 * `assets/screenshots/docs/<name>-light.png` and `<name>-dark.png`.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(docsDir, '.vitepress', 'dist');
const outDir = path.resolve(docsDir, '..', 'assets', 'screenshots', 'docs');
const base = process.env.DOCS_BASE ?? '/Tessera-Notes/';

const SHOTS = [
  { name: 'docs-home', path: '' },
  { name: 'docs-guide', path: 'guide/first-steps' },
  { name: 'docs-self-hosting', path: 'self-hosting/configuration' },
] as const;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** Resolves a request path to a file in dist, the way GitHub Pages does (clean URLs). */
async function resolveFile(urlPath: string): Promise<{ data: Buffer; type: string } | null> {
  if (!urlPath.startsWith(base)) return null;
  const relative = decodeURIComponent(urlPath.slice(base.length));
  const candidates =
    relative === '' || relative.endsWith('/')
      ? [`${relative}index.html`]
      : [relative, `${relative}.html`];
  for (const candidate of candidates) {
    const file = path.resolve(distDir, candidate);
    if (!file.startsWith(distDir + path.sep)) return null;
    try {
      const data = await readFile(file);
      return { data, type: TYPES[path.extname(file)] ?? 'application/octet-stream' };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function main() {
  const server = createServer((request, response) => {
    const urlPath = (request.url ?? '/').split('?')[0] ?? '/';
    resolveFile(urlPath).then(
      (found) => {
        if (!found) {
          response.writeHead(404).end('Not found');
          return;
        }
        response.writeHead(200, { 'Content-Type': found.type }).end(found.data);
      },
      () => response.writeHead(500).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const browser = await chromium.launch();
  try {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      for (const shot of SHOTS) {
        await page.goto(`http://127.0.0.1:${port}${base}${shot.path}`, {
          waitUntil: 'networkidle',
        });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(outDir, `${shot.name}-${colorScheme}.png`) });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.info(`Docs screenshots written to ${path.relative(path.resolve(docsDir, '..'), outDir)}`);
}

await main();
