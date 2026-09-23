/**
 * Runs a GitHub Actions workflow's jobs on this machine, for `scripts/ci/local.ts`: jobs in
 * `needs` order, every matrix combination, `if:` conditions, `run:` steps in bash (with the
 * GITHUB_OUTPUT, GITHUB_ENV, GITHUB_PATH and GITHUB_STEP_SUMMARY files), job outputs, and
 * `continue-on-error`. Actions are not run: setup actions are provided by your machine, and the
 * ones whose effects later steps rely on are emulated (path filters say "everything changed",
 * artifacts are copied through a local folder).
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  evaluateCondition,
  interpolate,
  isTruthy,
  usesStatusFunction,
  evaluateExpression,
  type ExpressionContext,
  type ExpressionValue,
} from './expressions';
import {
  expandMatrix,
  jobNeeds,
  jobOrder,
  loadWorkflow,
  type MatrixCombination,
  type Workflow,
  type WorkflowJob,
  type WorkflowStep,
} from './workflow';

export type JobResult = 'success' | 'failure' | 'skipped' | 'cancelled';

export interface StepRun {
  name: string;
  outcome: 'success' | 'failure' | 'skipped';
  durationMs: number;
  note?: string;
}

export interface JobRun {
  id: string;
  name: string;
  matrix: MatrixCombination;
  result: JobResult;
  steps: StepRun[];
  outputs: Record<string, string>;
  /** What the job wrote to GITHUB_STEP_SUMMARY. */
  summary: string;
  durationMs: number;
  /** Why the job was skipped, when it was. */
  reason?: string;
  /** `continue-on-error: true`: a failure is shown but doesn't fail the run. */
  continueOnError?: boolean;
}

export interface LocalRunOptions {
  workflowFile: string;
  repoRoot: string;
  /** The event to simulate (default `push`). */
  event?: string;
  /** Run only these jobs and the jobs they need. */
  jobs?: string[];
  /** Every matrix combination (default) or only the first of each job. */
  matrix?: 'all' | 'first';
  /** Print the plan without running anything. */
  dryRun?: boolean;
  /** Extra fields for the `github` context (for example `event.pull_request.title`). */
  github?: Record<string, ExpressionValue>;
  /** Where artifacts and scratch files go. Default `node_modules/.cache/ci-local`. */
  workDir?: string;
  /** Bash to run `run:` steps with (default: `bash`, or Git's bash on Windows). */
  bash?: string;
  /** `inherit` streams step output to this terminal; `pipe` collects it (tests). */
  stdio?: 'inherit' | 'pipe';
  log?: (line: string) => void;
}

export interface LocalRunResult {
  jobs: JobRun[];
  success: boolean;
}

/** Git's bash on Windows (WSL's `bash.exe` in System32 would run steps in Linux), `bash` elsewhere. */
export function findBash(): string {
  if (process.env.LOCAL_CI_BASH) return process.env.LOCAL_CI_BASH;
  if (process.platform !== 'win32') return 'bash';
  const candidates: string[] = [];
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    candidates.push(path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe'));
  } catch {
    // Git isn't on the PATH; fall back to the default install location.
  }
  candidates.push('C:\\Program Files\\Git\\bin\\bash.exe');
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Bash not found. Install Git for Windows or set LOCAL_CI_BASH.');
  return found;
}

/** Parses a GITHUB_OUTPUT / GITHUB_ENV file: `name=value` and `name<<DELIMITER` blocks. */
export function parseCommandFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line) continue;
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const [, name = '', delimiter = ''] = heredoc;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== delimiter) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      values[name] = body.join('\n');
      continue;
    }
    const equals = line.indexOf('=');
    if (equals > 0) values[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return values;
}

function stringRecord(record: Record<string, unknown> | undefined, context: ExpressionContext) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    result[key] = typeof value === 'string' ? interpolate(value, context) : String(value);
  }
  return result;
}

function toValue(value: unknown): ExpressionValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as ExpressionValue;
}

function readIfExists(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function actionName(uses: string): string {
  return uses.split('@')[0] ?? uses;
}

function stepName(step: WorkflowStep, context: ExpressionContext): string {
  if (step.name) return interpolate(step.name, context);
  if (step.uses) return `Run ${actionName(step.uses)}`;
  return `Run ${(step.run ?? '').trim().split('\n', 1)[0] ?? ''}`;
}

/** Glob with `*` only (artifact patterns). */
function matchesPattern(name: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return regex.test(name);
}

interface ActionEffect {
  outcome: 'success' | 'failure' | 'skipped';
  outputs?: Record<string, string>;
  note: string;
}

/** What each action does locally. */
function emulateAction(
  step: WorkflowStep,
  inputs: Record<string, string>,
  paths: { repoRoot: string; artifacts: string },
): ActionEffect {
  const action = actionName(step.uses ?? '');
  switch (action) {
    case 'actions/checkout':
      return { outcome: 'skipped', note: 'uses your working tree' };
    case 'actions/setup-node':
      return { outcome: 'skipped', note: `uses your Node.js ${process.version}` };
    case 'pnpm/action-setup':
      return { outcome: 'skipped', note: 'uses your pnpm' };
    case 'actions/cache':
      return { outcome: 'skipped', note: 'nothing to cache locally' };
    case 'dorny/paths-filter': {
      const filters = parseYaml(inputs.filters ?? '') as unknown;
      const names =
        typeof filters === 'object' && filters !== null ? Object.keys(filters as object) : [];
      return {
        outcome: 'success',
        outputs: Object.fromEntries(names.map((name) => [name, 'true'])),
        note: 'every path filter matches locally, so every job runs',
      };
    }
    case 'actions/upload-artifact': {
      const name = inputs.name || 'artifact';
      const target = path.join(paths.artifacts, name);
      rmSync(target, { recursive: true, force: true });
      let copied = 0;
      for (const entry of (inputs.path ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)) {
        const source = path.resolve(paths.repoRoot, entry);
        if (!existsSync(source)) continue;
        const destination = statSync(source).isDirectory()
          ? target
          : path.join(target, path.basename(source));
        cpSync(source, destination, { recursive: true });
        copied += 1;
      }
      if (!copied && (inputs['if-no-files-found'] ?? 'warn') === 'error') {
        return { outcome: 'failure', note: `no files for artifact "${name}"` };
      }
      return {
        outcome: 'success',
        note: copied ? `saved artifact "${name}"` : `no files for "${name}"`,
      };
    }
    case 'actions/download-artifact': {
      const available = existsSync(paths.artifacts) ? readdirSync(paths.artifacts) : [];
      const wanted = inputs.name
        ? available.filter((name) => name === inputs.name)
        : available.filter((name) => matchesPattern(name, inputs.pattern || '*'));
      const destination = path.resolve(paths.repoRoot, inputs.path || '.');
      const merge = inputs['merge-multiple'] === 'true' || Boolean(inputs.name);
      for (const name of wanted) {
        cpSync(
          path.join(paths.artifacts, name),
          merge ? destination : path.join(destination, name),
          {
            recursive: true,
          },
        );
      }
      return { outcome: 'success', note: `restored ${wanted.length} artifact(s)` };
    }
    default:
      return { outcome: 'skipped', note: 'not emulated locally' };
  }
}

function runScript(
  bash: string,
  script: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' | 'pipe'; scriptFile: string },
): Promise<{ code: number; output: string }> {
  writeFileSync(options.scriptFile, script);
  return new Promise((resolve) => {
    const child = spawn(bash, ['--noprofile', '--norc', '-eo', 'pipefail', options.scriptFile], {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: 1, output: `${output}${error.message}\n` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

function aggregateResult(runs: JobRun[]): JobResult {
  if (!runs.length) return 'skipped';
  if (runs.some((run) => run.result === 'failure')) return 'failure';
  if (runs.some((run) => run.result === 'cancelled')) return 'cancelled';
  if (runs.every((run) => run.result === 'skipped')) return 'skipped';
  return 'success';
}

/** The `github` context for a local run. */
function githubContext(
  options: LocalRunOptions,
  workflow: Workflow,
): Record<string, ExpressionValue> {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, {
        cwd: options.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const sha = git('rev-parse', 'HEAD');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || 'main';
  const event = options.event ?? 'push';
  const base = git('merge-base', 'HEAD', 'main') || sha;
  const context: Record<string, ExpressionValue> = {
    event_name: event,
    ref: event === 'pull_request' ? 'refs/pull/0/merge' : `refs/heads/${branch}`,
    ref_name: branch,
    head_ref: event === 'pull_request' ? branch : '',
    base_ref: event === 'pull_request' ? 'main' : '',
    sha,
    repository: 'local/tessera',
    repository_owner: 'local',
    workflow: workflow.name ?? path.basename(workflow.file),
    server_url: 'https://github.com',
    run_id: '0',
    actor: 'local',
    token: '',
    event: {
      pull_request:
        event === 'pull_request'
          ? {
              number: 0,
              title: git('log', '-1', '--format=%s'),
              base: { sha: base },
              head: { sha },
            }
          : null,
    },
  };
  return { ...context, ...options.github };
}

/** Runs the workflow. Never throws for failing steps: see `result.success`. */
export async function runWorkflowLocally(options: LocalRunOptions): Promise<LocalRunResult> {
  const log = options.log ?? ((line: string) => console.info(line));
  const workflow = loadWorkflow(options.workflowFile);
  const workDir =
    options.workDir ?? path.join(options.repoRoot, 'node_modules', '.cache', 'ci-local');
  const artifacts = path.join(workDir, 'artifacts');
  const scratch = path.join(workDir, 'tmp');
  if (!options.dryRun) {
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(artifacts, { recursive: true });
    mkdirSync(scratch, { recursive: true });
  }
  const bash = options.dryRun ? 'bash' : (options.bash ?? findBash());
  const github = githubContext(options, workflow);

  let order = jobOrder(workflow);
  if (options.jobs?.length) {
    const wanted = new Set<string>();
    const add = (id: string) => {
      if (wanted.has(id)) return;
      const job = workflow.jobs[id];
      if (!job) throw new Error(`No job "${id}" in ${options.workflowFile}`);
      wanted.add(id);
      jobNeeds(job).forEach(add);
    };
    options.jobs.forEach(add);
    order = order.filter((id) => wanted.has(id));
  }

  const runsByJob = new Map<string, JobRun[]>();
  const needsContext = (job: WorkflowJob): Record<string, ExpressionValue> =>
    Object.fromEntries(
      jobNeeds(job).map((need) => {
        const runs = runsByJob.get(need) ?? [];
        const outputs = Object.assign({}, ...runs.map((run) => run.outputs)) as Record<
          string,
          string
        >;
        return [need, { result: aggregateResult(runs), outputs }];
      }),
    );

  const all: JobRun[] = [];
  for (const id of order) {
    const job = workflow.jobs[id];
    if (!job) continue;
    const needs = needsContext(job);
    const needResults = Object.values(needs).map((need) =>
      typeof need === 'object' && need !== null && !Array.isArray(need) ? need.result : null,
    );
    const status = {
      success: needResults.every((result) => result === 'success'),
      failure: needResults.some((result) => result === 'failure'),
      cancelled: false,
    };
    const baseContexts: Record<string, ExpressionValue> = {
      github,
      needs,
      inputs: {},
      secrets: {},
      vars: {},
      env: toValue(workflow.env ?? {}),
    };
    const combinations =
      options.matrix === 'first'
        ? expandMatrix(job.strategy?.matrix).slice(0, 1)
        : expandMatrix(job.strategy?.matrix);
    const runs: JobRun[] = [];
    for (const [index, matrix] of combinations.entries()) {
      const context: ExpressionContext = {
        contexts: {
          ...baseContexts,
          matrix: toValue(matrix),
          strategy: { 'job-index': index, 'job-total': combinations.length },
        },
        status,
      };
      const name = interpolate(job.name ?? id, context);
      const run: JobRun = {
        id,
        name,
        matrix,
        result: 'success',
        steps: [],
        outputs: {},
        summary: '',
        durationMs: 0,
      };
      runs.push(run);
      all.push(run);

      const condition = job.if;
      const shouldRun =
        condition === undefined
          ? status.success
          : typeof condition === 'string' && usesStatusFunction(condition)
            ? evaluateCondition(condition, context)
            : status.success && evaluateCondition(condition, context);
      if (!shouldRun) {
        run.result = 'skipped';
        run.reason = status.success ? `if: ${String(condition)}` : 'a job it needs did not succeed';
        log(`⏭  ${name}: skipped (${run.reason})`);
        continue;
      }
      if (job.uses) {
        run.result = 'skipped';
        run.reason = `calls ${job.uses}, which runs only on GitHub`;
        log(`⏭  ${name}: skipped (${run.reason})`);
        continue;
      }
      log(`\n▶ ${name}`);
      const started = Date.now();
      const jobEnv = { ...stringRecord(workflow.env, context), ...stringRecord(job.env, context) };
      const addedEnv: Record<string, string> = {};
      const addedPath: string[] = [];
      const steps: Record<string, ExpressionValue> = {};
      let jobOk = true;
      for (const [stepIndex, step] of (job.steps ?? []).entries()) {
        const stepContext: ExpressionContext = {
          contexts: {
            ...context.contexts,
            steps,
            env: toValue({ ...jobEnv, ...addedEnv }),
            runner: {
              os:
                process.platform === 'win32'
                  ? 'Windows'
                  : process.platform === 'darwin'
                    ? 'macOS'
                    : 'Linux',
              temp: scratch,
            },
          },
          status: { success: jobOk, failure: !jobOk, cancelled: false },
        };
        const label = stepName(step, stepContext);
        const stepStarted = Date.now();
        if (!evaluateCondition(step.if, stepContext)) {
          run.steps.push({ name: label, outcome: 'skipped', durationMs: 0, note: 'if: false' });
          if (step.id) steps[step.id] = { outcome: 'skipped', conclusion: 'skipped', outputs: {} };
          continue;
        }
        const continueOnError = isTruthy(
          typeof step['continue-on-error'] === 'string'
            ? evaluateExpression(
                step['continue-on-error'].replace(/^\$\{\{|\}\}$/g, ''),
                stepContext,
              )
            : (step['continue-on-error'] ?? false),
        );
        let outcome: StepRun['outcome'];
        let outputs: Record<string, string> = {};
        let note: string | undefined;
        if (options.dryRun && (!step.uses || /-artifact$/.test(actionName(step.uses)))) {
          // A plan: list scripts and file-copying actions without running them.
          outcome = 'success';
          log(`   · ${label}`);
        } else if (step.uses) {
          const effect = emulateAction(step, stringRecord(step.with, stepContext), {
            repoRoot: options.repoRoot,
            artifacts,
          });
          outcome = effect.outcome;
          outputs = effect.outputs ?? {};
          note = effect.note;
          log(`   ${outcome === 'failure' ? '✖' : '·'} ${label} (${note})`);
        } else {
          log(`   ▸ ${label}`);
          const files = {
            output: path.join(scratch, `output-${stepIndex}`),
            env: path.join(scratch, `env-${stepIndex}`),
            path: path.join(scratch, `path-${stepIndex}`),
            summary: path.join(scratch, `summary-${stepIndex}`),
          };
          for (const file of Object.values(files)) writeFileSync(file, '');
          const pathSeparator = process.platform === 'win32' ? ';' : ':';
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            CI: 'true',
            GITHUB_WORKSPACE: options.repoRoot,
            GITHUB_EVENT_NAME: String(github.event_name ?? ''),
            GITHUB_REF: String(github.ref ?? ''),
            GITHUB_SHA: String(github.sha ?? ''),
            GITHUB_REPOSITORY: String(github.repository ?? ''),
            GITHUB_OUTPUT: files.output,
            GITHUB_ENV: files.env,
            GITHUB_PATH: files.path,
            GITHUB_STEP_SUMMARY: files.summary,
            RUNNER_TEMP: scratch,
            ...jobEnv,
            ...addedEnv,
            ...stringRecord(step.env, stepContext),
          };
          if (addedPath.length) {
            // Windows spells it `Path`; update whichever key the environment uses.
            const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
            env[key] = [...addedPath, env[key] ?? ''].join(pathSeparator);
          }
          const workingDirectory =
            step['working-directory'] ?? job.defaults?.run?.['working-directory'];
          const { code, output } = await runScript(bash, interpolate(step.run ?? '', stepContext), {
            cwd: workingDirectory
              ? path.resolve(options.repoRoot, workingDirectory)
              : options.repoRoot,
            env,
            stdio: options.stdio ?? 'inherit',
            scriptFile: path.join(scratch, `step-${stepIndex}.sh`),
          });
          outcome = code === 0 ? 'success' : 'failure';
          if (code !== 0) note = `exit code ${code}`;
          if (code !== 0 && options.stdio === 'pipe') log(output);
          outputs = parseCommandFile(readIfExists(files.output));
          Object.assign(addedEnv, parseCommandFile(readIfExists(files.env)));
          addedPath.unshift(...readIfExists(files.path).split(/\r?\n/).filter(Boolean));
          run.summary += readIfExists(files.summary);
        }
        const conclusion = outcome === 'failure' && continueOnError ? 'success' : outcome;
        if (step.id) steps[step.id] = { outcome, conclusion, outputs };
        run.steps.push({
          name: label,
          outcome,
          durationMs: Date.now() - stepStarted,
          ...(note ? { note } : {}),
        });
        if (conclusion === 'failure') jobOk = false;
      }
      const outputContext: ExpressionContext = {
        contexts: { ...context.contexts, steps },
        status: { success: jobOk, failure: !jobOk, cancelled: false },
      };
      run.outputs = stringRecord(job.outputs, outputContext);
      run.continueOnError = isTruthy(
        typeof job['continue-on-error'] === 'string'
          ? job['continue-on-error']
          : (job['continue-on-error'] ?? false),
      );
      run.result = jobOk ? 'success' : 'failure';
      run.durationMs = Date.now() - started;
      log(
        `${run.result === 'success' ? '✔' : '✖'} ${name} (${(run.durationMs / 1000).toFixed(1)} s)`,
      );
    }
    runsByJob.set(id, runs);
  }
  return {
    jobs: all,
    success: all.every(
      (run) => run.continueOnError || (run.result !== 'failure' && run.result !== 'cancelled'),
    ),
  };
}

/** A markdown table of the run, for the terminal and `summary.md`. */
export function formatRunTable(result: LocalRunResult): string {
  const icon: Record<JobResult, string> = {
    success: '✅',
    failure: '❌',
    skipped: '⏭️',
    cancelled: '🚫',
  };
  const rows = result.jobs.map(
    (run) =>
      `| ${icon[run.result]} ${run.result}${run.continueOnError && run.result === 'failure' ? ' (allowed)' : ''} | ${run.name} | ${run.result === 'skipped' ? (run.reason ?? '') : `${(run.durationMs / 1000).toFixed(1)} s`} |`,
  );
  return ['| Result | Job | Time |', '| --- | --- | --- |', ...rows].join('\n');
}
