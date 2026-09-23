/**
 * The commit-msg hook: checks the message against Conventional Commits (the same rules CI checks
 * on pull requests). Plain Node, so it adds no noticeable time to a commit.
 * `git commit --no-verify` skips it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cleanMessage, formatLintResult, lintCommit } from '../lib/conventional-commits.ts';

/** Git's comment character (`core.commentChar`), `#` unless configured. */
function commentChar(): string {
  try {
    const value = execFileSync('git', ['config', '--get', 'core.commentChar'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return value && value !== 'auto' ? value : '#';
  } catch {
    return '#';
  }
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: commit-msg.ts <message file>');
  process.exit(2);
}
const message = cleanMessage(readFileSync(file, 'utf8'), commentChar());
const result = lintCommit(message);
if (!result.ignored && (!result.valid || result.warnings.length)) {
  console.error(formatLintResult('Commit message', message, result));
}
if (!result.valid) {
  console.error(
    '\nUse "type(scope): subject", for example "feat(editor): add a slash menu".' +
      '\nTypes: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.' +
      '\nYour message is kept in .git/COMMIT_EDITMSG.',
  );
  process.exit(1);
}
