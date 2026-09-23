/**
 * The pre-commit hook: ESLint (with fixes) and Prettier on the staged files only, through
 * lint-staged (a dev dependency of @tessera/testkit), which keeps partially staged files intact.
 * `git commit --no-verify` skips it.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
// lint-staged isn't a root dependency (root files are the Architect's), so resolve it from the
// package that declares it.
const require = createRequire(path.join(root, 'packages', 'testkit', 'package.json'));

interface LintStagedOptions {
  configPath?: string;
  cwd?: string;
  quiet?: boolean;
}
type LintStaged = (options: LintStagedOptions) => Promise<boolean>;

let lintStaged: LintStaged;
try {
  const module = (await import(pathToFileURL(require.resolve('lint-staged')).href)) as {
    default: LintStaged;
  };
  lintStaged = module.default;
} catch {
  console.error(
    'lint-staged is not installed; run `pnpm install`. Skipping the pre-commit checks.',
  );
  process.exit(0);
}

const passed = await lintStaged({
  configPath: path.join(import.meta.dirname, 'lint-staged.config.mjs'),
  cwd: root,
});
process.exitCode = passed ? 0 : 1;
