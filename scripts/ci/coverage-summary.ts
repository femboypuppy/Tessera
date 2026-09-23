/**
 * Turns Vitest's `coverage/coverage-summary.json` (the istanbul `json-summary` reporter, enabled
 * in the root vitest config) into a markdown table per package, printed and appended to the
 * GitHub job summary.
 *
 *   pnpm test:coverage && node scripts/ci/coverage-summary.ts coverage/coverage-summary.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendJobSummary } from '../lib/github.ts';

const METRICS = ['lines', 'statements', 'functions', 'branches'] as const;
type Metric = (typeof METRICS)[number];

interface Count {
  total: number;
  covered: number;
}

type FileSummary = Record<Metric, Count>;

function isCount(value: unknown): value is Count {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.total === 'number' && typeof record.covered === 'number';
}

function isFileSummary(value: unknown): value is FileSummary {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return METRICS.every((metric) => isCount(record[metric]));
}

/** `packages/core`, `apps/web`, … for a file path (absolute or relative, any separator). */
export function packageOf(file: string): string {
  const match = /(?:^|\/)((?:packages|apps)\/[^/]+)\//.exec(file.replace(/\\/g, '/'));
  return match?.[1] ?? 'other';
}

export interface CoverageRow {
  name: string;
  counts: FileSummary;
}

/** Sums the per-file summaries by package, sorted by name, plus the total. */
export function summarizeCoverage(json: unknown): { total: FileSummary; rows: CoverageRow[] } {
  if (typeof json !== 'object' || json === null) throw new TypeError('Not a coverage summary');
  const entries = Object.entries(json as Record<string, unknown>);
  const empty = (): FileSummary => ({
    lines: { total: 0, covered: 0 },
    statements: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
  });
  const byPackage = new Map<string, FileSummary>();
  const total = empty();
  for (const [file, summary] of entries) {
    if (file === 'total' || !isFileSummary(summary)) continue;
    const name = packageOf(file);
    const counts = byPackage.get(name) ?? empty();
    for (const metric of METRICS) {
      counts[metric].total += summary[metric].total;
      counts[metric].covered += summary[metric].covered;
      total[metric].total += summary[metric].total;
      total[metric].covered += summary[metric].covered;
    }
    byPackage.set(name, counts);
  }
  const rows = [...byPackage.entries()]
    .map(([name, counts]) => ({ name, counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { total, rows };
}

function percent({ total, covered }: Count): string {
  if (total === 0) return '–';
  return `${((covered / total) * 100).toFixed(1)}%`;
}

/** The markdown table for the job summary. */
export function coverageMarkdown(json: unknown): string {
  const { total, rows } = summarizeCoverage(json);
  const line = (name: string, counts: FileSummary) =>
    `| ${name} | ${METRICS.map((metric) => percent(counts[metric])).join(' | ')} |`;
  return [
    '## Unit test coverage',
    '',
    '| Package | Lines | Statements | Functions | Branches |',
    '| --- | ---: | ---: | ---: | ---: |',
    line('**All packages**', total),
    ...rows.map((row) => line(`\`${row.name}\``, row.counts)),
    '',
    `${total.lines.covered.toLocaleString('en-US')} of ${total.lines.total.toLocaleString('en-US')} lines covered. The \`coverage\` artifact has the full HTML report (\`lcov-report/index.html\`).`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const file = process.argv[2] ?? 'coverage/coverage-summary.json';
  if (!existsSync(file)) {
    console.error(`No coverage summary at ${file}; run \`pnpm test:coverage\` first.`);
    process.exitCode = 1;
  } else {
    const markdown = coverageMarkdown(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    console.log(markdown);
    appendJobSummary(markdown);
  }
}
