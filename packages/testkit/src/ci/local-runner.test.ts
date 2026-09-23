import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRunTable,
  parseCommandFile,
  runWorkflowLocally,
  type LocalRunResult,
} from './local-runner';
import { expandMatrix, jobOrder } from './workflow';

const WORKFLOW = `
name: Sample
on: [push, pull_request]
env:
  GREETING: hello
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      code: \${{ github.event_name != 'pull_request' || steps.filter.outputs.code == 'true' }}
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000 # v1
      - id: filter
        if: github.event_name == 'pull_request'
        uses: dorny/paths-filter@0000000000000000000000000000000000000000 # v1
        with:
          filters: |
            code:
              - '**'
  build:
    needs: changes
    if: needs.changes.outputs.code == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        size: [small, large]
        include:
          - size: large
            extra: yes
    outputs:
      last: \${{ steps.make.outputs.made }}
    steps:
      - name: Make \${{ matrix.size }}
        id: make
        env:
          SIZE: \${{ matrix.size }}
        run: |
          mkdir -p out
          echo "$GREETING $SIZE \${{ matrix.extra }}" > "out/$SIZE.txt"
          echo "made=$SIZE" >> "$GITHUB_OUTPUT"
          echo "FROM_ENV_FILE=yes" >> "$GITHUB_ENV"
          echo "### Built $SIZE" >> "$GITHUB_STEP_SUMMARY"
      - name: Env file carries over
        run: test "$FROM_ENV_FILE" = yes
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v1
        with:
          name: out-\${{ matrix.size }}
          path: out/
  consume:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@0000000000000000000000000000000000000000 # v1
        with:
          pattern: out-*
          path: merged
          merge-multiple: true
      - name: Both artifacts arrived
        run: test -f merged/small.txt && test -f merged/large.txt && grep -q "large yes" merged/large.txt
      - name: Needs outputs
        run: test "\${{ needs.build.outputs.last }}" = large
  flaky:
    runs-on: ubuntu-latest
    steps:
      - name: Allowed to fail
        id: allowed
        continue-on-error: true
        run: exit 3
      - name: Still runs
        run: echo "outcome=\${{ steps.allowed.outcome }} conclusion=\${{ steps.allowed.conclusion }}" > flaky.txt
  broken:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
      - name: Skipped after a failure
        run: echo never > never.txt
      - name: Runs on failure
        if: failure()
        run: echo cleanup > cleanup.txt
  after-broken:
    needs: broken
    runs-on: ubuntu-latest
    steps:
      - run: echo never > never2.txt
  report:
    needs: [broken, build]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Results
        env:
          RESULTS: \${{ join(needs.*.result, ' ') }}
        run: echo "$RESULTS" > results.txt
  pr-only:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - run: echo pr > pr.txt
`;

describe('local workflow runner', () => {
  let repo = '';
  let result: LocalRunResult;
  const lines: string[] = [];
  const file = (name: string) => path.join(repo, name);

  beforeAll(async () => {
    repo = mkdtempSync(path.join(tmpdir(), 'tessera-ci-local-'));
    writeFileSync(file('ci.yml'), WORKFLOW);
    result = await runWorkflowLocally({
      workflowFile: file('ci.yml'),
      repoRoot: repo,
      event: 'push',
      stdio: 'pipe',
      workDir: path.join(repo, '.ci-local'),
      log: (line) => lines.push(line),
    });
  }, 60_000);
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const job = (id: string) => result.jobs.filter((run) => run.id === id);

  it('runs jobs in needs order across every matrix combination', () => {
    expect(job('build').map((run) => [run.matrix, run.result])).toEqual([
      [{ size: 'small' }, 'success'],
      [{ size: 'large', extra: 'yes' }, 'success'],
    ]);
    expect(readFileSync(file('out/large.txt'), 'utf8').trim()).toBe('hello large yes');
    expect(job('build')[0]?.summary).toContain('### Built small');
    expect(job('changes')[0]?.outputs).toEqual({ code: 'true' });
  });

  it('passes artifacts and job outputs to later jobs', () => {
    expect(job('consume')[0]?.result).toBe('success');
  });

  it('honors continue-on-error and exposes outcome and conclusion', () => {
    expect(job('flaky')[0]?.result).toBe('success');
    expect(readFileSync(file('flaky.txt'), 'utf8').trim()).toBe(
      'outcome=failure conclusion=success',
    );
  });

  it('stops a failed job, runs failure() steps, and skips jobs that need it', () => {
    expect(job('broken')[0]?.result).toBe('failure');
    expect(existsSync(file('never.txt'))).toBe(false);
    expect(readFileSync(file('cleanup.txt'), 'utf8').trim()).toBe('cleanup');
    expect(job('after-broken')[0]).toMatchObject({
      result: 'skipped',
      reason: 'a job it needs did not succeed',
    });
    expect(readFileSync(file('results.txt'), 'utf8').trim()).toBe('failure success');
    expect(result.success).toBe(false);
  });

  it('skips jobs whose condition does not hold for the simulated event', () => {
    expect(job('pr-only')[0]?.result).toBe('skipped');
    expect(existsSync(file('pr.txt'))).toBe(false);
  });

  it('prints a result table', () => {
    const table = formatRunTable(result);
    expect(table).toContain('| ❌ failure | broken |');
    expect(table).toContain('| ⏭️ skipped | pr-only | if: github.event_name ==');
    expect(lines.some((line) => line.includes('every path filter matches locally'))).toBe(false);
  });

  it('emulates path filters on pull requests and lists the plan in a dry run', async () => {
    const dry: string[] = [];
    const planned = await runWorkflowLocally({
      workflowFile: file('ci.yml'),
      repoRoot: repo,
      event: 'pull_request',
      jobs: ['consume'],
      dryRun: true,
      log: (line) => dry.push(line),
    });
    expect(planned.jobs.map((run) => run.id)).toEqual(['changes', 'build', 'build', 'consume']);
    expect(dry.join('\n')).toContain('· Make small');
  });
});

describe('workflow helpers', () => {
  it('orders jobs after the jobs they need and rejects cycles', () => {
    expect(jobOrder({ jobs: { c: { needs: ['a', 'b'] }, b: { needs: 'a' }, a: {} } })).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(() => jobOrder({ jobs: { a: { needs: 'b' }, b: { needs: 'a' } } })).toThrow(/Cycle/);
    expect(() => jobOrder({ jobs: { a: { needs: 'missing' } } })).toThrow(/Unknown job/);
  });

  it('expands matrices like Actions, with include and exclude', () => {
    expect(expandMatrix(undefined)).toEqual([{}]);
    expect(
      expandMatrix({
        os: ['linux', 'windows'],
        node: [22, 24],
        exclude: [{ os: 'windows', node: 22 }],
        include: [
          { os: 'linux', experimental: true },
          { os: 'macos', node: 24 },
        ],
      }),
    ).toEqual([
      { os: 'linux', node: 22, experimental: true },
      { os: 'linux', node: 24, experimental: true },
      { os: 'windows', node: 24 },
      { os: 'macos', node: 24 },
    ]);
    expect(expandMatrix({ include: [{ name: 'a' }, { name: 'b' }] })).toEqual([
      { name: 'a' },
      { name: 'b' },
    ]);
  });

  it('parses GITHUB_OUTPUT files, including multi-line values', () => {
    expect(parseCommandFile('a=1\nb=x=y\nnotes<<EOF\nline 1\nline 2\nEOF\n\nc=\n')).toEqual({
      a: '1',
      b: 'x=y',
      notes: 'line 1\nline 2',
      c: '',
    });
  });
});
