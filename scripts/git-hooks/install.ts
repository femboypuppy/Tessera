/**
 * Points git at the hooks in scripts/git-hooks/hooks (`core.hooksPath`). Run once per clone:
 *
 *   node scripts/git-hooks/install.ts          # skipped in CI and outside a git checkout
 *   node scripts/git-hooks/install.ts --force  # also replaces another core.hooksPath
 *
 * It never overwrites a hooks path you set yourself unless you pass --force.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const HOOKS_PATH = 'scripts/git-hooks/hooks';

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** What install would do: `install`, or a reason to skip. */
export function plan(options: {
  ci: boolean;
  insideWorkTree: boolean;
  currentHooksPath: string | null;
  force: boolean;
}): { action: 'install' | 'skip'; reason: string } {
  if (options.ci) return { action: 'skip', reason: 'CI runs the same checks itself.' };
  if (!options.insideWorkTree) return { action: 'skip', reason: 'Not inside a git checkout.' };
  if (options.currentHooksPath === HOOKS_PATH)
    return { action: 'skip', reason: 'Already installed.' };
  if (options.currentHooksPath && !options.force) {
    return {
      action: 'skip',
      reason: `core.hooksPath is already "${options.currentHooksPath}". Pass --force to use Tessera's hooks instead.`,
    };
  }
  return { action: 'install', reason: `Git hooks installed (core.hooksPath = ${HOOKS_PATH}).` };
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const decision = plan({
    ci: Boolean(process.env.CI),
    insideWorkTree: git(['rev-parse', '--is-inside-work-tree'], root) === 'true',
    currentHooksPath: git(['config', '--get', 'core.hooksPath'], root) || null,
    force: process.argv.includes('--force'),
  });
  if (decision.action === 'install') {
    execFileSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { cwd: root });
    // Hooks must be executable on macOS and Linux (git on Windows runs them through sh).
    for (const hook of readdirSync(path.join(root, HOOKS_PATH))) {
      chmodSync(path.join(root, HOOKS_PATH, hook), 0o755);
    }
  }
  console.info(decision.reason);
}
