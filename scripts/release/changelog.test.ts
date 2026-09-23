import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectCommits, previousTag, renderChangelog } from './changelog.ts';

const sha = (n: number) => String(n).repeat(40).slice(0, 40);

describe('renderChangelog', () => {
  it('groups commits into sections, highlights breaking changes and links everything', () => {
    const markdown = renderChangelog({
      repo: 'tessera/tessera',
      from: 'v0.1.0',
      to: 'v0.2.0',
      commits: [
        { sha: sha(1), message: 'feat(editor): add a slash menu (#12)' },
        { sha: sha(2), message: 'fix: keep focus after undo' },
        {
          sha: sha(3),
          message: 'feat(core)!: rename page helpers\n\nBREAKING CHANGE: createPage is now addPage',
        },
        { sha: sha(4), message: 'build(deps): bump vitest from 5.0.1 to 5.0.2' },
        { sha: sha(5), message: 'ci: cache browsers' },
        { sha: sha(6), message: "Merge branch 'main' into feat/x" },
        { sha: sha(7), message: 'Tweak things' },
      ],
    });
    const link = (n: number) =>
      `([\`${sha(n).slice(0, 7)}\`](https://github.com/tessera/tessera/commit/${sha(n)}))`;
    expect(markdown).toBe(
      [
        '### ⚠ Breaking changes',
        '',
        `- **core:** createPage is now addPage ${link(3)}`,
        '',
        '### Features',
        '',
        `- **editor:** add a slash menu (#12) ${link(1)}`,
        `- **core:** rename page helpers ${link(3)}`,
        '',
        '### Bug fixes',
        '',
        `- keep focus after undo ${link(2)}`,
        '',
        '<details>',
        '<summary><strong>Maintenance</strong> (2)</summary>',
        '',
        `- **deps:** bump vitest from 5.0.1 to 5.0.2 ${link(4)}`,
        `- cache browsers ${link(5)}`,
        '',
        '</details>',
        '',
        '### Other changes',
        '',
        `- Tweak things ${link(7)}`,
        '',
        '**Full changelog:** https://github.com/tessera/tessera/compare/v0.1.0...v0.2.0',
        '',
      ].join('\n'),
    );
  });

  it('adds a heading for CHANGELOG.md and links all commits for a first release', () => {
    const markdown = renderChangelog({
      repo: 'o/r',
      from: null,
      to: 'v0.1.0',
      commits: [],
      heading: { date: '2026-09-23' },
    });
    expect(markdown).toBe(
      '## v0.1.0 (2026-09-23)\n\nNo changes.\n\n**Full changelog:** https://github.com/o/r/commits/v0.1.0\n',
    );
  });
});

describe('collectCommits and previousTag', () => {
  let repo = '';
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    });
  const commit = (message: string) => {
    writeFileSync(path.join(repo, 'file.txt'), message);
    git('add', 'file.txt');
    git('commit', '-q', '--no-verify', '-m', message);
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'tessera-changelog-'));
    git('init', '-q', '-b', 'main');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    commit('chore: start');
    git('tag', 'v0.1.0');
    commit('feat: add x');
    commit('fix: repair x\n\nWith a body.');
    git('tag', 'v0.2.0');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('finds the previous tag, or none for the first release', () => {
    expect(previousTag('v0.2.0', repo)).toBe('v0.1.0');
    expect(previousTag('v0.1.0', repo)).toBeNull();
  });

  it('lists the commits between two tags, newest first, with full messages', () => {
    const commits = collectCommits('v0.1.0', 'v0.2.0', repo);
    expect(commits.map((entry) => entry.message)).toEqual([
      'fix: repair x\n\nWith a body.',
      'feat: add x',
    ]);
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(collectCommits(null, 'v0.1.0', repo).map((entry) => entry.message)).toEqual([
      'chore: start',
    ]);
  });
});
