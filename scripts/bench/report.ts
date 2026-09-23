/**
 * Benchmark results: the JSON the suite writes, the markdown table it prints, and the comparison
 * with a baseline (the latest run on main) that pull requests get as a comment.
 */
import { formatMs } from './stats.ts';

export interface BenchResult {
  id: string;
  title: string;
  status: 'ok' | 'skipped' | 'failed';
  /** The headline number (lower is better). */
  value?: number;
  unit?: 'ms';
  /** What the headline number is (`median of 3 runs`, `p95 of 60 queries`). */
  measure?: string;
  /** The budget from SPEC.md section 10, when there is one. */
  budget?: { max: number; label: string };
  withinBudget?: boolean;
  /** Secondary numbers and facts (which implementation ran, sizes, …). */
  details?: Record<string, number | string>;
  /** Why it was skipped or failed. */
  reason?: string;
}

export interface BenchRun {
  version: 1;
  startedAt: string;
  commit: string | null;
  environment: { os: string; node: string; browser: string; cpus: number };
  results: BenchResult[];
}

/** Differences under this share are noise on shared CI runners. */
export const NOISE = 0.1;

function budgetCell(result: BenchResult): string {
  if (!result.budget) return '–';
  return `< ${formatMs(result.budget.max)}`;
}

function statusCell(result: BenchResult): string {
  if (result.status === 'skipped') return '⏭️';
  if (result.status === 'failed') return '❌';
  if (result.withinBudget === undefined) return 'ℹ️';
  return result.withinBudget ? '✅' : '❌';
}

function resultCell(result: BenchResult): string {
  if (result.status === 'skipped') return `skipped: ${result.reason ?? ''}`;
  if (result.status === 'failed') return `failed: ${result.reason ?? ''}`;
  const value = result.value === undefined ? '–' : formatMs(result.value);
  return result.measure ? `${value} (${result.measure})` : value;
}

/** How a result moved against the baseline: `+12% ⚠️`, `−8%`, `±0%`. */
export function change(current: BenchResult, baseline: BenchResult | undefined): string {
  if (
    !baseline ||
    baseline.value === undefined ||
    current.value === undefined ||
    baseline.value === 0
  ) {
    return '–';
  }
  const ratio = (current.value - baseline.value) / baseline.value;
  const percent = Math.round(ratio * 100);
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '±';
  const text = `${sign}${Math.abs(percent)}%`;
  if (ratio > NOISE) return `${text} ⚠️`;
  if (ratio < -NOISE) return `${text} 🚀`;
  return text;
}

/** The markdown report: one row per benchmark, with a comparison column when there is a baseline. */
export function benchMarkdown(run: BenchRun, baseline?: BenchRun | null): string {
  const byId = new Map((baseline?.results ?? []).map((result) => [result.id, result]));
  const compare = Boolean(baseline);
  const header = compare
    ? ['| Benchmark | Result | Budget | | vs main |', '| --- | --- | --- | :-: | --- |']
    : ['| Benchmark | Result | Budget | |', '| --- | --- | --- | :-: |'];
  const rows = run.results.map((result) => {
    const cells = [result.title, resultCell(result), budgetCell(result), statusCell(result)];
    if (compare) cells.push(change(result, byId.get(result.id)));
    return `| ${cells.join(' | ')} |`;
  });
  const details = run.results
    .filter((result) => result.details && Object.keys(result.details).length)
    .map(
      (result) =>
        `- **${result.title}:** ${Object.entries(result.details ?? {})
          .map(([key, value]) => `${key} ${typeof value === 'number' ? formatMs(value) : value}`)
          .join(', ')}`,
    );
  const env = run.environment;
  return [
    '## Benchmarks',
    '',
    ...header,
    ...rows,
    '',
    ...(details.length
      ? ['<details><summary>Details</summary>', '', ...details, '', '</details>', '']
      : []),
    `${env.browser} on ${env.os}, ${env.cpus} CPUs, Node ${env.node}${run.commit ? `, commit ${run.commit.slice(0, 7)}` : ''}.` +
      (compare ? ` Changes within ±${NOISE * 100}% are noise on shared runners.` : ''),
    '',
  ].join('\n');
}

/** Reads a results file, or null when it is missing or not a run. */
export function parseRun(text: string | null): BenchRun | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<BenchRun>;
    return value.version === 1 && Array.isArray(value.results) ? (value as BenchRun) : null;
  } catch {
    return null;
  }
}
