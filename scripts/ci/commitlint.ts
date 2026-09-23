/**
 * Checks commit messages against Conventional Commits (scripts/lib/conventional-commits.ts).
 *
 *   node scripts/ci/commitlint.ts --from <base> --to <head>   # every non-merge commit in base..head
 *   node scripts/ci/commitlint.ts --title "feat: add x"       # a pull request title
 *   node scripts/ci/commitlint.ts --file .git/COMMIT_EDITMSG  # a message file (the commit-msg hook)
 *   node scripts/ci/commitlint.ts --message "fix: y"
 *
 * Options combine. Exits with 1 when any message has errors (warnings never fail).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { annotateError, inGitHubActions } from '../lib/github.ts';
import { cleanMessage, formatLintResult, lintCommit } from '../lib/conventional-commits.ts';

interface Checked {
  label: string;
  message: string;
}

/** Non-merge commits in `from..to`, oldest first. */
export function commitsInRange(from: string, to: string, cwd = process.cwd()): Checked[] {
  const output = execFileSync(
    'git',
    ['log', '--no-merges', '--reverse', '--format=%h%x00%B%x1e', `${from}..${to}`],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .split('\x1e')
    .map((entry) => entry.replace(/^\n+/, ''))
    .filter((entry) => entry.includes('\x00'))
    .map((entry) => {
      const [sha = '', message = ''] = entry.split('\x00');
      return { label: sha, message: message.trim() };
    });
}

function main(): number {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string', default: 'HEAD' },
      title: { type: 'string' },
      file: { type: 'string' },
      message: { type: 'string' },
    },
  });
  const checked: Checked[] = [];
  if (values.from) checked.push(...commitsInRange(values.from, values.to ?? 'HEAD'));
  if (values.title !== undefined)
    checked.push({ label: 'Pull request title', message: values.title });
  if (values.file) {
    checked.push({
      label: 'Commit message',
      message: cleanMessage(readFileSync(values.file, 'utf8')),
    });
  }
  if (values.message !== undefined) checked.push({ label: 'Message', message: values.message });
  if (!checked.length) {
    console.error('Nothing to check. Pass --from/--to, --title, --file or --message.');
    return 2;
  }

  let failures = 0;
  for (const { label, message } of checked) {
    const result = lintCommit(message);
    if (result.ignored) continue;
    console.log(formatLintResult(label, message, result));
    if (!result.valid) {
      failures += 1;
      if (inGitHubActions()) {
        annotateError(`${label}: ${result.errors.join(' ')}`, 'Conventional Commits');
      }
    }
  }
  if (failures) {
    console.log(
      `\n${failures} message(s) need fixing. Format: "type(scope): subject", for example "feat(editor): add a slash menu".` +
        '\nSee CONTRIBUTING.md and https://www.conventionalcommits.org.',
    );
    return 1;
  }
  console.log(`\nAll ${checked.length} message(s) follow Conventional Commits.`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
