/**
 * The bundle-size report for the web app, checked against the budget in SPEC.md (section 10).
 *
 *   pnpm --filter @tessera/web build
 *   node scripts/bundle/report.ts [--dist apps/web/dist] [--json bundle-report.json]
 *
 * Prints a markdown report (also appended to the GitHub job summary) and exits with 1 when the
 * startup JS is over budget. `--routes` adds the JS each screen loads, measured in Chromium.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { appendJobSummary, annotateError, inGitHubActions } from '../lib/github.ts';
import {
  analyzeBundle,
  formatKB,
  readBundle,
  type BundleAnalysis,
  type BundleGraph,
} from './analyze.ts';

export interface Budgets {
  startup: { maxGzipBytes: number; bootModules: string[] };
}

export function readBudgets(file: string): Budgets {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Partial<Budgets>;
  const startup = json.startup;
  if (
    !startup ||
    typeof startup.maxGzipBytes !== 'number' ||
    !Array.isArray(startup.bootModules) ||
    !startup.bootModules.every((module) => typeof module === 'string')
  ) {
    throw new Error(
      `${file}: expected { startup: { maxGzipBytes: number, bootModules: string[] } }`,
    );
  }
  return { startup: { maxGzipBytes: startup.maxGzipBytes, bootModules: startup.bootModules } };
}

/** Markdown for the terminal and the job summary. */
export function bundleMarkdown(analysis: BundleAnalysis, budgets: Budgets, lazyRows = 15): string {
  const budget = budgets.startup.maxGzipBytes;
  const share = Math.round((analysis.startupGzip / budget) * 100);
  const ok = analysis.startupGzip <= budget;
  const lines = [
    '## Bundle size',
    '',
    `${ok ? '✅' : '❌'} **Startup JS: ${formatKB(analysis.startupGzip)} gzip** of the ${formatKB(budget)} budget (${share}%), ${formatKB(analysis.startupRaw)} minified.`,
    '',
    '| Startup chunk | Why | Minified | Gzip |',
    '| --- | --- | ---: | ---: |',
    ...analysis.startup.map(
      (file) =>
        `| \`${path.posix.basename(file.file)}\` | ${file.reason}${file.facade ? ` (\`${file.facade}\`)` : ''} | ${formatKB(file.raw)} | ${formatKB(file.gzip)} |`,
    ),
  ];
  if (analysis.missingBootModules.length) {
    lines.push(
      '',
      `⚠️ Boot modules not found in any chunk: ${analysis.missingBootModules.map((module) => `\`${module}\``).join(', ')}. Was the build made without sourcemaps?`,
    );
  }
  if (analysis.lazy.length) {
    const shown = analysis.lazy.slice(0, lazyRows);
    lines.push(
      '',
      `### Lazy chunks (${analysis.lazy.length}, loaded on demand)`,
      '',
      '| Chunk | Module | Adds (minified) | Adds (gzip) |',
      '| --- | --- | ---: | ---: |',
      ...shown.map(
        (chunk) =>
          `| \`${path.posix.basename(chunk.file)}\` | ${(chunk.facade ?? chunk.mainSource) ? `\`${chunk.facade ?? chunk.mainSource}\`` : '–'} | ${formatKB(chunk.addedRaw)} | ${formatKB(chunk.addedGzip)} |`,
      ),
    );
    if (analysis.lazy.length > shown.length) {
      lines.push('', `…and ${analysis.lazy.length - shown.length} smaller chunks.`);
    }
  }
  lines.push(
    '',
    `All JS: ${formatKB(analysis.totalGzip)} gzip (${formatKB(analysis.totalRaw)} minified). Gzip is measured with zlib's default level; Vite's build log shows about 1% more.`,
    '',
  );
  return lines.join('\n');
}

export interface RouteSize {
  label: string;
  route: string;
  chunks: number;
  gzip: number;
  /** What the route loads on top of the startup JS. */
  beyondStartupGzip: number;
}

/** Sizes of the chunks each route loaded, from the static analysis. */
export function routeSizes(
  graph: BundleGraph,
  analysis: BundleAnalysis,
  visits: ReadonlyArray<{ label: string; route: string; files: string[] }>,
): RouteSize[] {
  const startup = new Set(analysis.startup.map((file) => file.file));
  return visits.map((visit) => {
    const known = visit.files.filter((file) => graph.chunks.has(file));
    const gzipOf = (files: string[]) =>
      files.reduce((sum, file) => sum + (graph.chunks.get(file)?.gzip ?? 0), 0);
    return {
      label: visit.label,
      route: visit.route,
      chunks: known.length,
      gzip: gzipOf(known),
      beyondStartupGzip: gzipOf(known.filter((file) => !startup.has(file))),
    };
  });
}

/** The "JS per route" table. */
export function routesMarkdown(routes: readonly RouteSize[]): string {
  return [
    '### JS per route',
    '',
    'Chunks each screen loads in a fresh browser (idle-time preloads held back), gzip.',
    '',
    '| Screen | Route | Loaded | Beyond startup | Chunks |',
    '| --- | --- | ---: | ---: | ---: |',
    ...routes.map(
      (route) =>
        `| ${route.label} | \`${route.route}\` | ${formatKB(route.gzip)} | ${formatKB(route.beyondStartupGzip)} | ${route.chunks} |`,
    ),
    '',
  ].join('\n');
}

async function main(): Promise<number> {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: path.join(root, 'apps/web/dist') },
      budgets: { type: 'string', default: path.join(import.meta.dirname, 'budgets.json') },
      json: { type: 'string' },
      routes: { type: 'boolean', default: false },
    },
  });
  const budgets = readBudgets(values.budgets ?? '');
  const dist = values.dist ?? '';
  const graph = readBundle(dist, root);
  const analysis = analyzeBundle(graph, budgets.startup.bootModules);
  let markdown = bundleMarkdown(analysis, budgets);
  let routes: RouteSize[] = [];
  if (values.routes) {
    // Loaded only when asked: it launches a browser.
    const { measureRoutes } = await import('./routes.ts');
    routes = routeSizes(graph, analysis, await measureRoutes(path.dirname(path.resolve(dist))));
    markdown += `\n${routesMarkdown(routes)}`;
  }
  console.log(markdown);
  appendJobSummary(markdown);
  if (values.json) {
    writeFileSync(values.json, `${JSON.stringify({ budgets, ...analysis, routes }, null, 2)}\n`);
  }
  if (analysis.startupGzip > budgets.startup.maxGzipBytes) {
    const message = `Startup JS is ${formatKB(analysis.startupGzip)} gzip, over the ${formatKB(budgets.startup.maxGzipBytes)} budget (SPEC.md section 10). Move heavy imports behind lazy() or import().`;
    if (inGitHubActions()) annotateError(message, 'Bundle budget');
    else console.error(`error: ${message}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
