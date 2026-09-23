import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  evaluateExpression,
  interpolate,
  isTruthy,
  type ExpressionContext,
} from './expressions';

const context: ExpressionContext = {
  contexts: {
    github: {
      event_name: 'pull_request',
      ref: 'refs/heads/main',
      event: { pull_request: { number: 7 } },
    },
    needs: {
      changes: { result: 'success', outputs: { code: 'true', workflows: 'false' } },
      e2e: { result: 'failure', outputs: {} },
      'e2e-report': { result: 'skipped', outputs: {} },
    },
    matrix: { browser: 'firefox', shard: 2 },
    inputs: { push: true, 'release-id': '' },
    secrets: {},
    strategy: { 'job-total': 4 },
  },
};

const run = (source: string, extra: Partial<ExpressionContext> = {}) =>
  evaluateExpression(source, { ...context, ...extra });

describe('evaluateExpression', () => {
  it('reads contexts with dots, brackets, dashes and case-insensitive names', () => {
    expect(run('github.event_name')).toBe('pull_request');
    expect(run("github['event']['pull_request'].number")).toBe(7);
    expect(run('needs.e2e-report.result')).toBe('skipped');
    expect(run('GITHUB.EVENT_NAME')).toBe('pull_request');
    expect(run('strategy.job-total')).toBe(4);
    expect(run('github.missing.deep')).toBeNull();
    expect(run('unknown')).toBeNull();
  });

  it('supports object filters', () => {
    expect(run('needs.*.result')).toEqual(['success', 'failure', 'skipped']);
    expect(run("join(needs.*.result, ' ')")).toBe('success failure skipped');
    expect(run("contains(needs.*.result, 'failure')")).toBe(true);
  });

  it('compares like Actions: strings case-insensitively, other types as numbers', () => {
    expect(run("github.event_name == 'PULL_REQUEST'")).toBe(true);
    expect(run("needs.changes.outputs.code == 'true'")).toBe(true);
    expect(run("needs.changes.outputs.workflows == 'true'")).toBe(false);
    expect(run('matrix.shard == 2')).toBe(true);
    expect(run("matrix.shard == '2'")).toBe(true);
    expect(run('inputs.push == true')).toBe(true);
    expect(run("inputs.push == 'true'")).toBe(false);
    expect(run('null == 0')).toBe(true);
    expect(run('1 < 2 && 3 >= 3')).toBe(true);
    expect(run("'b' > 'A'")).toBe(true);
  });

  it('returns operands from && and ||, and negates with !', () => {
    expect(run("inputs.release-id || 'none'")).toBe('none');
    expect(run("matrix.browser && 'yes'")).toBe('yes');
    expect(run("inputs.push == true && 'linux/amd64,linux/arm64' || 'linux/amd64'")).toBe(
      'linux/amd64,linux/arm64',
    );
    expect(run('!inputs.release-id')).toBe(true);
    expect(run("!startsWith(github.ref, 'refs/tags/v0.')")).toBe(true);
    expect(run('(1 == 1) && !(2 == 3)')).toBe(true);
  });

  it('implements the functions the workflows use', () => {
    expect(run("format('{0}/{1} {{x}}', matrix.browser, matrix.shard)")).toBe('firefox/2 {x}');
    expect(run("endsWith('abc.yml', '.YML')")).toBe(true);
    expect(run("contains('Hello', 'ell')")).toBe(true);
    expect(run('fromJSON(\'{"a":[1,2]}\').a[1]')).toBe(2);
    expect(run('toJSON(matrix)')).toBe('{\n  "browser": "firefox",\n  "shard": 2\n}');
    expect(run("hashFiles('**/x')", { hashFiles: (patterns) => patterns.join('+') })).toBe('**/x');
    expect(run("'it''s'")).toBe("it's");
    expect(run('-1 < 0')).toBe(true);
  });

  it('reports syntax errors and unknown functions', () => {
    expect(() => run('github.')).toThrow(SyntaxError);
    expect(() => run("'open")).toThrow(/Unterminated/);
    expect(() => run('nope()')).toThrow(/Unknown function/);
    expect(() => run('a b')).toThrow(/Unexpected token/);
  });
});

describe('evaluateCondition', () => {
  const failed = { success: false, failure: true, cancelled: false };

  it('accepts expressions with or without ${{ }}', () => {
    expect(evaluateCondition("github.event_name == 'pull_request'", context)).toBe(true);
    expect(evaluateCondition("${{ github.event_name == 'push' }}", context)).toBe(false);
    expect(evaluateCondition(undefined, context)).toBe(true);
  });

  it('requires success() implicitly unless a status function is used', () => {
    const afterFailure = { ...context, status: failed };
    expect(evaluateCondition("github.event_name == 'pull_request'", afterFailure)).toBe(false);
    expect(evaluateCondition(undefined, afterFailure)).toBe(false);
    expect(evaluateCondition('always()', afterFailure)).toBe(true);
    expect(evaluateCondition('failure()', afterFailure)).toBe(true);
    expect(evaluateCondition('${{ !cancelled() }}', afterFailure)).toBe(true);
    expect(evaluateCondition("!cancelled() && needs.e2e.result != 'skipped'", afterFailure)).toBe(
      true,
    );
  });
});

describe('interpolate and isTruthy', () => {
  it('replaces every expression in a string', () => {
    expect(interpolate('E2E (${{ matrix.browser }} ${{ matrix.shard }}/2)', context)).toBe(
      'E2E (firefox 2/2)',
    );
    expect(interpolate('${{ inputs.release-id }}|${{ github.nothing }}', context)).toBe('|');
    expect(interpolate("${{ github.event_name != 'pull_request' || 'x' }}", context)).toBe('x');
  });

  it('treats null, false, 0, NaN and empty strings as falsy', () => {
    for (const value of [null, false, 0, Number.NaN, '']) expect(isTruthy(value)).toBe(false);
    for (const value of ['false', '0', [], {}, 1, true]) expect(isTruthy(value)).toBe(true);
  });
});
