/**
 * Turns Lighthouse CI's results (`upload.target: filesystem`) into a markdown table of scores per
 * URL, printed and appended to the GitHub job summary.
 *
 *   pnpm dlx @lhci/cli@0.15.1 autorun --config=scripts/lighthouse/lighthouserc.json
 *   node scripts/lighthouse/summary.ts .lighthouseci/reports/manifest.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendJobSummary } from '../lib/github.ts';

const CATEGORIES = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['best-practices', 'Best practices'],
  ['seo', 'SEO'],
] as const;

interface ManifestEntry {
  url: string;
  isRepresentativeRun: boolean;
  summary: Partial<Record<(typeof CATEGORIES)[number][0], number>>;
}

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.url === 'string' &&
    typeof entry.isRepresentativeRun === 'boolean' &&
    typeof entry.summary === 'object' &&
    entry.summary !== null
  );
}

function score(value: number | undefined): string {
  if (value === undefined) return '–';
  const points = Math.round(value * 100);
  const mark = points >= 90 ? '🟢' : points >= 50 ? '🟠' : '🔴';
  return `${mark} ${points}`;
}

/** The markdown table for the representative run of each URL. */
export function lighthouseMarkdown(manifest: unknown): string {
  const entries = (Array.isArray(manifest) ? manifest : []).filter(isEntry);
  const representative = entries.filter((entry) => entry.isRepresentativeRun);
  const rows = (representative.length ? representative : entries).map((entry) => {
    const path = new URL(entry.url).pathname;
    return `| \`${path}\` | ${CATEGORIES.map(([key]) => score(entry.summary[key])).join(' | ')} |`;
  });
  return [
    '## Lighthouse',
    '',
    `| Page | ${CATEGORIES.map(([, label]) => label).join(' | ')} |`,
    `| --- | ${CATEGORIES.map(() => ':-:').join(' | ')} |`,
    ...(rows.length ? rows : ['| (no results) | – | – | – | – |']),
    '',
    'Median of 3 runs per page, desktop preset. The `lighthouse` artifact has the full reports.',
    '',
  ].join('\n');
}

if (import.meta.main) {
  const file = process.argv[2] ?? '.lighthouseci/reports/manifest.json';
  if (!existsSync(file)) {
    console.error(`No Lighthouse manifest at ${file}.`);
    process.exitCode = 1;
  } else {
    const markdown = lighthouseMarkdown(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    console.log(markdown);
    appendJobSummary(markdown);
  }
}
