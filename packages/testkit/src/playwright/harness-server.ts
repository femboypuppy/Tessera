/**
 * Serves the seeded harness app (packages/testkit/harness) for Playwright: a Vite dev server for
 * end-to-end fixtures (always fresh, no build step) or a production build for benchmarks.
 */
import { fileURLToPath } from 'node:url';
import { build, createServer, preview } from 'vite';
import type { GenerateOptions } from '../generator';

const CONFIG = fileURLToPath(new URL('../../harness/vite.config.ts', import.meta.url));

export interface HarnessServer {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** The harness URL for a generated workspace (the query string carries the options). */
  url(options?: GenerateOptions, path?: string): string;
  close(): Promise<void>;
}

/** The harness query string for generator options (read back by harness/params.ts). */
export function harnessSearch(options: GenerateOptions = {}): string {
  const params = new URLSearchParams();
  if (options.seed !== undefined) params.set('seed', String(options.seed));
  if (options.pages !== undefined) params.set('pages', String(options.pages));
  if (options.databases !== undefined) params.set('databases', String(options.databases));
  if (options.rowsPerDatabase !== undefined) {
    const rows = options.rowsPerDatabase;
    params.set('rows', String(typeof rows === 'number' ? rows : rows[1]));
  }
  if (options.trashed !== undefined) params.set('trashed', String(options.trashed));
  if (options.maxDepth !== undefined) params.set('depth', String(options.maxDepth));
  if (options.linksPerPage !== undefined) params.set('links', String(options.linksPerPage));
  if (options.largePages?.length) params.set('large', options.largePages.join(','));
  const search = params.toString();
  return search ? `?${search}` : '';
}

function server(origin: string, close: () => Promise<void>): HarnessServer {
  return {
    origin,
    url: (options, path = '/') => `${origin}${path}${harnessSearch(options)}`,
    close,
  };
}

/**
 * Starts the harness on a free port. `mode: 'dev'` (default) serves sources through Vite;
 * `mode: 'preview'` builds once (`outDir`) and serves the production build.
 */
export async function startHarness(
  options: { mode?: 'dev' | 'preview'; port?: number; cacheDir?: string; outDir?: string } = {},
): Promise<HarnessServer> {
  const port = options.port ?? 0;
  if (options.mode === 'preview') {
    await build({
      configFile: CONFIG,
      logLevel: 'warn',
      ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
      ...(options.outDir ? { build: { outDir: options.outDir, emptyOutDir: true } } : {}),
    });
    const previewServer = await preview({
      configFile: CONFIG,
      logLevel: 'warn',
      preview: { port, host: '127.0.0.1', strictPort: port !== 0 },
      ...(options.outDir ? { build: { outDir: options.outDir } } : {}),
    });
    const origin = previewServer.resolvedUrls?.local[0]?.replace(/\/$/, '');
    if (!origin) throw new Error('The harness preview server has no URL');
    return server(origin, () => previewServer.close());
  }
  const devServer = await createServer({
    configFile: CONFIG,
    logLevel: 'warn',
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    server: { port, host: '127.0.0.1', strictPort: port !== 0 },
  });
  await devServer.listen();
  const origin = devServer.resolvedUrls?.local[0]?.replace(/\/$/, '');
  if (!origin) throw new Error('The harness dev server has no URL');
  return server(origin, () => devServer.close());
}
