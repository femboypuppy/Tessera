import { describe, expect, it } from 'vitest';
import { coverageMarkdown, packageOf, summarizeCoverage } from './coverage-summary.ts';

const count = (total: number, covered: number) => ({ total, covered, skipped: 0, pct: 0 });
const file = (lines: [number, number], branches: [number, number] = [0, 0]) => ({
  lines: count(...lines),
  statements: count(...lines),
  functions: count(2, 1),
  branches: count(...branches),
});

const json = {
  total: file([999, 999]),
  'C:\\repo\\packages\\core\\src\\ids.ts': file([10, 8], [4, 2]),
  '/repo/packages/core/src/order.ts': file([30, 30]),
  '/repo/apps/web/src/main.tsx': file([20, 5]),
  '/repo/vitest.config.ts': file([2, 0]),
};

describe('coverage summary', () => {
  it('finds the package of a file on any OS', () => {
    expect(packageOf('C:\\repo\\packages\\core\\src\\a.ts')).toBe('packages/core');
    expect(packageOf('/home/runner/work/x/apps/web/src/main.tsx')).toBe('apps/web');
    expect(packageOf('packages/ui/src/x.ts')).toBe('packages/ui');
    expect(packageOf('/repo/vitest.config.ts')).toBe('other');
  });

  it('sums files by package and ignores the precomputed total', () => {
    const { total, rows } = summarizeCoverage(json);
    expect(rows.map((row) => row.name)).toEqual(['apps/web', 'other', 'packages/core']);
    expect(rows[2]?.counts.lines).toEqual({ total: 40, covered: 38 });
    expect(total.lines).toEqual({ total: 62, covered: 43 });
    expect(total.branches).toEqual({ total: 4, covered: 2 });
  });

  it('renders a markdown table with a dash for empty metrics', () => {
    const markdown = coverageMarkdown(json);
    expect(markdown).toContain('| **All packages** | 69.4% | 69.4% | 50.0% | 50.0% |');
    expect(markdown).toContain('| `packages/core` | 95.0% | 95.0% | 50.0% | 50.0% |');
    expect(markdown).toContain('| `apps/web` | 25.0% | 25.0% | 50.0% | – |');
    expect(markdown).toContain('43 of 62 lines covered.');
  });

  it('rejects input that is not a summary', () => {
    expect(() => summarizeCoverage(null)).toThrow(TypeError);
  });
});
