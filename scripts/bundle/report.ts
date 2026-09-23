/**
 * The bundle-size report for the web app, checked against the budget in SPEC.md (section 10).
 *
 *   pnpm --filter @tessera/web build
 *   node scripts/bundle/report.ts [--dist apps/web/dist] [--json bundle-report.json]
 *
 * Prints a markdown report (also appended to the GitHub job summary) and exits with 1 when the
 * startup JS is over budget. For the JS each route loads in a real browser, add `--routes`
 * (`pnpm exec tsx scripts/bundle/routes.ts`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { appendJobSummary, annotateError, inGitHubActions } from '../lib/github.ts';
import { analyzeBundle, formatKB, readBundle, type BundleAnalysis } from './analyze.ts';

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

function main(): number {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: path.join(root, 'apps/web/dist') },
      budgets: { type: 'string', default: path.join(import.meta.dirname, 'budgets.json') },
      json: { type: 'string' },
    },
  });
  const budgets = readBudgets(values.budgets ?? '');
  const analysis = analyzeBundle(readBundle(values.dist ?? '', root), budgets.startup.bootModules);
  const markdown = bundleMarkdown(analysis, budgets);
  console.log(markdown);
  appendJobSummary(markdown);
  if (values.json) {
    writeFileSync(values.json, `${JSON.stringify({ budgets, ...analysis }, null, 2)}\n`);
  }
  if (analysis.startupGzip > budgets.startup.maxGzipBytes) {
    const message = `Startup JS is ${formatKB(analysis.startupGzip)} gzip, over the ${formatKB(budgets.startup.maxGzipBytes)} budget (SPEC.md section 10). Move heavy imports behind lazy() or import().`;
    if (inGitHubActions()) annotateError(message, 'Bundle budget');
    else console.error(`error: ${message}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exitCode = main();
