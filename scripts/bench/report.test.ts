import { describe, expect, it } from 'vitest';
import { benchMarkdown, change, parseRun, type BenchResult, type BenchRun } from './report.ts';
import { formatMs, mean, median, percentile, summarize } from './stats.ts';

describe('stats', () => {
  it('computes percentiles by interpolation', () => {
    const samples = [5, 1, 4, 2, 3];
    expect(percentile(samples, 0)).toBe(1);
    expect(percentile(samples, 50)).toBe(3);
    expect(percentile(samples, 100)).toBe(5);
    expect(percentile([10, 20], 95)).toBeCloseTo(19.5);
    expect(percentile([], 50)).toBeNaN();
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('summarizes samples', () => {
    const summary = summarize([4, 1, 3, 2]);
    expect(summary).toMatchObject({ count: 4, min: 1, p50: 2.5, max: 4, mean: 2.5 });
    expect(summary.p95).toBeCloseTo(3.85);
  });

  it('formats milliseconds with fewer decimals as values grow', () => {
    expect(formatMs(1234.5)).toBe('1,235 ms');
    expect(formatMs(12.345)).toBe('12.3 ms');
    expect(formatMs(0.4213)).toBe('0.42 ms');
    expect(formatMs(Number.NaN)).toBe('–');
  });
});

const result = (patch: Partial<BenchResult>): BenchResult => ({
  id: 'cold-start',
  title: 'Cold start, 5,000 pages',
  status: 'ok',
  value: 800,
  unit: 'ms',
  ...patch,
});

const run = (results: BenchResult[]): BenchRun => ({
  version: 1,
  startedAt: '2026-09-23T00:00:00.000Z',
  commit: 'abcdef1234',
  environment: { os: 'linux', node: 'v24.15.0', browser: 'Chromium 140', cpus: 4 },
  results,
});

describe('change', () => {
  it('flags regressions and improvements beyond the noise level', () => {
    expect(change(result({ value: 1200 }), result({ value: 1000 }))).toBe('+20% ⚠️');
    expect(change(result({ value: 800 }), result({ value: 1000 }))).toBe('−20% 🚀');
    expect(change(result({ value: 1050 }), result({ value: 1000 }))).toBe('+5%');
    expect(change(result({ value: 1000 }), result({ value: 1000 }))).toBe('±0%');
    expect(change(result({}), undefined)).toBe('–');
    expect(change(result({ status: 'skipped', value: undefined }), result({}))).toBe('–');
  });
});

describe('benchMarkdown', () => {
  it('renders results against budgets, with skips and details', () => {
    const markdown = benchMarkdown(
      run([
        result({
          measure: 'median of 3 runs',
          budget: { max: 2000, label: 'SPEC' },
          withinBudget: true,
          details: { runs: '3', 'since navigation': 1234 },
        }),
        result({
          id: 'search',
          title: 'Search p95',
          value: 70,
          budget: { max: 50, label: 'SPEC' },
          withinBudget: false,
        }),
        result({
          id: 'typing',
          title: 'Typing latency',
          status: 'skipped',
          value: undefined,
          reason: 'needs the editor',
        }),
        result({ id: 'open', title: 'Open a page', value: 120 }),
      ]),
    );
    expect(markdown).toContain(
      '| Cold start, 5,000 pages | 800 ms (median of 3 runs) | < 2,000 ms | ✅ |',
    );
    expect(markdown).toContain('| Search p95 | 70.0 ms | < 50.0 ms | ❌ |');
    expect(markdown).toContain('| Typing latency | skipped: needs the editor | – | ⏭️ |');
    expect(markdown).toContain('| Open a page | 120 ms | – | ℹ️ |');
    expect(markdown).toContain('- **Cold start, 5,000 pages:** runs 3, since navigation 1,234 ms');
    expect(markdown).toContain('Chromium 140 on linux, 4 CPUs, Node v24.15.0, commit abcdef1.');
  });

  it('adds a comparison column with a baseline', () => {
    const markdown = benchMarkdown(run([result({ value: 1200 })]), run([result({ value: 1000 })]));
    expect(markdown).toContain('| Benchmark | Result | Budget | | vs main |');
    expect(markdown).toContain('| +20% ⚠️ |');
  });
});

describe('parseRun', () => {
  it('reads runs and rejects anything else', () => {
    const text = JSON.stringify(run([result({})]));
    expect(parseRun(text)?.results).toHaveLength(1);
    expect(parseRun(null)).toBeNull();
    expect(parseRun('not json')).toBeNull();
    expect(parseRun('{"version":2}')).toBeNull();
  });
});
