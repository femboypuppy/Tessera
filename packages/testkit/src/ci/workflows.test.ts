/**
 * Policy checks for `.github/`: every workflow pins its actions to commit SHAs, grants the least
 * permissions, has timeouts, avoids script injection, and the CI gate covers every required job.
 * actionlint (scripts/ci/actionlint.ts) checks syntax and types; these check our own rules.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadWorkflows, type Workflow, type WorkflowJob } from './workflow';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const WORKFLOWS = loadWorkflows(path.join(ROOT, '.github', 'workflows'));
const byName = (file: string): Workflow => {
  const workflow = WORKFLOWS.find((candidate) => path.basename(candidate.file) === file);
  if (!workflow) throw new Error(`Missing workflow ${file}`);
  return workflow;
};

/** Every `uses:` line of every workflow, with its file. */
const usesLines = WORKFLOWS.flatMap((workflow) =>
  workflow.text
    .split('\n')
    .map((line) => /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      file: path.basename(workflow.file),
      ref: match[1] ?? '',
      rest: match[2] ?? '',
    })),
);

const steps = (job: WorkflowJob) => job.steps ?? [];

describe('.github/workflows', () => {
  it('has the workflows the project needs', () => {
    expect(WORKFLOWS.map((workflow) => path.basename(workflow.file))).toEqual(
      expect.arrayContaining([
        'bench.yml',
        'ci.yml',
        'codeql.yml',
        'desktop.yml',
        'docker.yml',
        'docs.yml',
        'labeler.yml',
        'release.yml',
      ]),
    );
  });

  it('pins every third-party action to a full commit SHA with a version comment', () => {
    const remote = usesLines.filter((line) => !line.ref.startsWith('./'));
    expect(remote.length).toBeGreaterThan(20);
    for (const line of remote) {
      expect(line.ref, `${line.file}: ${line.ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      expect(line.rest, `${line.file}: ${line.ref} needs "# vX.Y.Z"`).toMatch(
        /^\s+#\s+v\d+\.\d+\.\d+$/,
      );
    }
  });

  it('pins each action to the same commit everywhere', () => {
    const pins = new Map<string, Set<string>>();
    for (const line of usesLines.filter((entry) => !entry.ref.startsWith('./'))) {
      const [action = '', sha = ''] = line.ref.split('@');
      const repo = action.split('/').slice(0, 2).join('/');
      pins.set(repo, new Set([...(pins.get(repo) ?? []), sha]));
    }
    for (const [repo, shas] of pins) expect([...shas], repo).toHaveLength(1);
  });

  it('defaults to read-only permissions and gives every job explicit permissions', () => {
    for (const workflow of WORKFLOWS) {
      const file = path.basename(workflow.file);
      expect(workflow.permissions, file).toEqual({ contents: 'read' });
      for (const [id, job] of Object.entries(workflow.jobs)) {
        expect(job.permissions, `${file} → ${id}`).toBeDefined();
      }
    }
  });

  it('sets a timeout on every job that runs on a runner', () => {
    for (const workflow of WORKFLOWS) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        if (job.uses) continue;
        expect(job['timeout-minutes'], `${path.basename(workflow.file)} → ${id}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('never persists the checkout token', () => {
    for (const workflow of WORKFLOWS) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        for (const step of steps(job).filter((entry) =>
          entry.uses?.startsWith('actions/checkout@'),
        )) {
          expect(
            step.with?.['persist-credentials'],
            `${path.basename(workflow.file)} → ${id}`,
          ).toBe(false);
        }
      }
    }
  });

  it('passes untrusted event data to scripts through env, never inline', () => {
    for (const workflow of WORKFLOWS) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        for (const step of steps(job)) {
          expect(step.run ?? '', `${path.basename(workflow.file)} → ${id}`).not.toMatch(
            /\$\{\{\s*github\.(?:event|head_ref)/,
          );
        }
      }
    }
  });

  it('never checks out code in pull_request_target workflows', () => {
    for (const workflow of WORKFLOWS) {
      const triggers =
        typeof workflow.on === 'object' && workflow.on !== null ? Object.keys(workflow.on) : [];
      if (!triggers.includes('pull_request_target')) continue;
      for (const job of Object.values(workflow.jobs)) {
        expect(steps(job).some((step) => step.uses?.startsWith('actions/checkout@'))).toBe(false);
      }
    }
  });

  it('only runs scripts that exist', () => {
    for (const workflow of WORKFLOWS) {
      for (const match of workflow.text.matchAll(/(?:node|tsx)\s+(scripts\/[\w./-]+\.ts)/g)) {
        expect(
          existsSync(path.join(ROOT, match[1] ?? '')),
          `${path.basename(workflow.file)}: ${match[1]}`,
        ).toBe(true);
      }
    }
  });
});

describe('ci.yml', () => {
  const ci = byName('ci.yml');

  it('cancels superseded runs and runs on pull requests and main', () => {
    expect(ci.concurrency).toMatchObject({ 'cancel-in-progress': true });
    expect(ci.on).toMatchObject({ pull_request: null, push: { branches: ['main'] } });
  });

  it('gates on every required job through the final "CI" job', () => {
    const gate = ci.jobs.ci;
    expect(gate?.if).toBe('always()');
    const nonBlocking = new Set(['ci', 'audit', 'e2e-report', 'lighthouse']);
    const required = Object.keys(ci.jobs).filter((id) => !nonBlocking.has(id));
    expect([...(gate?.needs ?? [])].sort()).toEqual(required.sort());
  });

  it('runs e2e on Chromium and Firefox in shards', () => {
    expect(ci.jobs.e2e?.strategy?.matrix).toEqual({
      browser: ['chromium', 'firefox'],
      shard: [1, 2],
    });
    const run = steps(ci.jobs.e2e ?? {}).find((step) => step.name === 'Playwright')?.run ?? '';
    expect(run).toContain('--project=${{ matrix.browser }}');
    expect(run).toContain('--shard=${{ matrix.shard }}/2');
  });

  it('times the @perf specs alone, after the others', () => {
    const e2e = steps(ci.jobs.e2e ?? {});
    const main = e2e.find((step) => step.name === 'Playwright')?.run ?? '';
    const timed = e2e.find((step) => step.name === 'Playwright, timed specs alone')?.run ?? '';
    expect(main).toContain('--grep-invert @perf');
    expect(timed).toContain('--grep @perf');
    expect(timed).toContain('--workers=1');
    expect(timed).toContain('--project=${{ matrix.browser }}');
    expect(e2e.findIndex((step) => step.run === timed)).toBeGreaterThan(
      e2e.findIndex((step) => step.run === main),
    );
  });

  it('calls the same root scripts contributors run', () => {
    const runs = Object.values(ci.jobs).flatMap((job) => steps(job).map((step) => step.run ?? ''));
    for (const command of [
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test:coverage',
      'pnpm build',
      'pnpm test:e2e',
    ]) {
      expect(
        runs.some((run) => run.includes(command)),
        command,
      ).toBe(true);
    }
  });
});

describe('docker.yml', () => {
  it('publishes ghcr.io/<owner>/tessera whatever the repository is called', () => {
    // The repository became Tessera-Notes; the image kept its name so docker commands keep working.
    const job = byName('docker.yml').jobs.image ?? {};
    const name = steps(job).find((step) => step.name === 'Image name');
    expect(name?.env).toEqual({ OWNER: '${{ github.repository_owner }}' });
    expect(name?.run).toContain('name=ghcr.io/${OWNER,,}/tessera');
  });
});

describe('desktop.yml', () => {
  const desktop = byName('desktop.yml');
  const job = Object.values(desktop.jobs)[0] ?? {};
  const build = steps(job).find((step) => step.name === 'Tauri build');
  const secrets = steps(job).find((step) => step.name === 'Signing secrets');

  it('hands the Tauri build only the signing secrets that are set', () => {
    // An unset secret is an empty string, and an empty APPLE_CERTIFICATE made the macOS builds
    // of v0.1.0 fail importing it: the build step's env holds no secret but the token.
    expect(Object.keys(build?.env ?? {})).toEqual(['GITHUB_TOKEN']);
    const run = secrets?.run ?? '';
    expect(run).toContain('if [ -n "${!name}" ]');
    expect(run).toContain('"$GITHUB_ENV"');
    for (const name of [
      'APPLE_CERTIFICATE',
      'APPLE_SIGNING_IDENTITY',
      'TAURI_SIGNING_PRIVATE_KEY',
    ]) {
      expect(secrets?.env?.[name]).toBe(`\${{ secrets.${name} }}`);
    }
    expect(steps(job).indexOf(secrets ?? {})).toBeLessThan(steps(job).indexOf(build ?? {}));
  });

  it('ad-hoc signs the macOS app when no Apple certificate is set', () => {
    const config = JSON.parse(
      readFileSync(path.join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
    ) as { bundle?: { macOS?: { signingIdentity?: string } } };
    expect(config.bundle?.macOS?.signingIdentity).toBe('-');
  });
});

describe('dependabot.yml and labeler.yml', () => {
  it('updates npm weekly (grouped), actions monthly and cargo weekly', () => {
    const config = parse(readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8')) as {
      updates: Array<{
        'package-ecosystem': string;
        schedule: { interval: string };
        groups?: object;
      }>;
    };
    const find = (ecosystem: string) =>
      config.updates.filter((update) => update['package-ecosystem'] === ecosystem);
    expect(
      find('npm').every((update) => update.schedule.interval === 'weekly' && update.groups),
    ).toBe(true);
    expect(find('npm')).not.toHaveLength(0);
    expect(find('github-actions').map((update) => update.schedule.interval)).toEqual(['monthly']);
    expect(find('cargo').map((update) => update.schedule.interval)).toEqual(['weekly']);
  });

  it('labels every area by path', () => {
    const config = parse(readFileSync(path.join(ROOT, '.github', 'labeler.yml'), 'utf8')) as Record<
      string,
      Array<{ 'changed-files': Array<{ 'any-glob-to-any-file': string | string[] }> }>
    >;
    for (const area of [
      'editor',
      'sync',
      'databases',
      'search',
      'plugins',
      'desktop',
      'import-export',
      'ci',
    ]) {
      expect(Object.keys(config)).toContain(`area: ${area}`);
    }
    for (const [label, rules] of Object.entries(config)) {
      const globs = rules.flatMap((rule) =>
        rule['changed-files'].flatMap((entry) => entry['any-glob-to-any-file']),
      );
      expect(globs.length, label).toBeGreaterThan(0);
    }
  });
});
