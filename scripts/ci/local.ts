/**
 * Runs a workflow's jobs on your machine, in the same order and with the same commands as GitHub
 * Actions (see packages/testkit/src/ci/local-runner.ts for what is emulated).
 *
 *   pnpm exec tsx scripts/ci/local.ts                         # every job of ci.yml, as a push to main
 *   pnpm exec tsx scripts/ci/local.ts --event pull_request     # as a pull request (adds the commit check)
 *   pnpm exec tsx scripts/ci/local.ts --job lint --job unit    # some jobs (and the jobs they need)
 *   pnpm exec tsx scripts/ci/local.ts --matrix first           # one combination per matrix job
 *   pnpm exec tsx scripts/ci/local.ts --dry-run                # the plan only
 *   pnpm exec tsx scripts/ci/local.ts --workflow .github/workflows/bench.yml
 *
 * Job summaries are collected in node_modules/.cache/ci-local/summary.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { formatRunTable, runWorkflowLocally } from '../../packages/testkit/src/ci/local-runner';

const root = path.resolve(import.meta.dirname, '..', '..');
const { values } = parseArgs({
  options: {
    workflow: { type: 'string', default: '.github/workflows/ci.yml' },
    event: { type: 'string', default: 'push' },
    job: { type: 'string', multiple: true },
    matrix: { type: 'string', default: 'all' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const matrix = values.matrix === 'first' ? 'first' : 'all';
const started = Date.now();
const result = await runWorkflowLocally({
  workflowFile: path.resolve(root, values.workflow ?? ''),
  repoRoot: root,
  event: values.event,
  jobs: values.job,
  matrix,
  dryRun: values['dry-run'],
});

const table = formatRunTable(result);
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
if (values['dry-run']) {
  const planned = result.jobs.filter((run) => run.result !== 'skipped').length;
  console.info(
    `\nPlan: ${planned} of ${result.jobs.length} job runs would run (nothing was executed).`,
  );
} else {
  console.info(
    `\n${table}\n\n${result.success ? 'All jobs passed' : 'Some jobs failed'} (${minutes} min).`,
  );
}
if (!values['dry-run']) {
  const dir = path.join(root, 'node_modules', '.cache', 'ci-local');
  mkdirSync(dir, { recursive: true });
  const summaries = result.jobs
    .filter((run) => run.summary.trim())
    .map((run) => `<!-- ${run.name} -->\n${run.summary.trim()}`)
    .join('\n\n');
  writeFileSync(
    path.join(dir, 'summary.md'),
    `# Local run of ${values.workflow} (${values.event})\n\n${table}\n\n${summaries}\n`,
  );
  console.info(`Job summaries: ${path.relative(root, path.join(dir, 'summary.md'))}`);
}
process.exitCode = result.success ? 0 : 1;
