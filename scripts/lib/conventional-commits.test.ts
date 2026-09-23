import { describe, expect, it } from 'vitest';
import {
  cleanMessage,
  formatLintResult,
  isIgnoredCommit,
  lintCommit,
  parseCommit,
} from './conventional-commits.ts';

describe('parseCommit', () => {
  it('parses type, scope, subject, body and footers', () => {
    const parsed = parseCommit(
      [
        'feat(editor): add a slash menu',
        '',
        'Typing "/" opens a menu of blocks.',
        'It is keyboard accessible.',
        '',
        'Refs: #12',
        'Co-Authored-By: Ada <ada@example.com>',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      header: 'feat(editor): add a slash menu',
      type: 'feat',
      scope: 'editor',
      breaking: false,
      breakingNote: null,
      subject: 'add a slash menu',
      body: 'Typing "/" opens a menu of blocks.\nIt is keyboard accessible.',
      footers: [
        { token: 'Refs', value: '#12' },
        { token: 'Co-Authored-By', value: 'Ada <ada@example.com>' },
      ],
    });
  });

  it('detects breaking changes from "!" and from the footer', () => {
    expect(parseCommit('feat(core)!: rename the page helpers')?.breaking).toBe(true);
    const footer = parseCommit(
      'refactor: move settings\n\nBREAKING CHANGE: settings keys are now namespaced\n  by feature.',
    );
    expect(footer?.breaking).toBe(true);
    expect(footer?.breakingNote).toBe('settings keys are now namespaced\nby feature.');
    expect(footer?.body).toBe('');
  });

  it('keeps a last paragraph that is not all footers in the body', () => {
    const parsed = parseCommit('fix: handle empty titles\n\nSee: the spec\nand more prose here');
    expect(parsed?.footers).toEqual([]);
    expect(parsed?.body).toBe('See: the spec\nand more prose here');
  });

  it('returns null for headers that are not conventional', () => {
    expect(parseCommit('Add stuff')).toBeNull();
    expect(parseCommit('feat add stuff')).toBeNull();
    expect(parseCommit('feat(editor) add stuff')).toBeNull();
  });
});

describe('lintCommit', () => {
  it('accepts well-formed messages, including multiple scopes and dependency updates', () => {
    for (const message of [
      'feat(editor): add slash menu',
      'fix: keep focus after undo',
      'build(deps-dev): bump vitest from 5.0.1 to 5.0.2',
      'ci(deps): bump actions/checkout in the actions group',
      'docs(core,ui): explain the tokens',
      'perf(search)!: index in a worker\n\nBREAKING CHANGE: the index is async',
    ]) {
      const result = lintCommit(message);
      expect(result.errors, message).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('explains what is wrong', () => {
    expect(lintCommit('Added stuff.').errors[0]).toMatch(/must look like "type\(scope\): subject"/);
    expect(lintCommit('feature: add x').errors).toEqual([
      'Unknown type "feature". Use one of: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.',
    ]);
    expect(lintCommit('Feat: add x').errors).toEqual([
      'The type must be lowercase: "feat", not "Feat".',
    ]);
    expect(lintCommit('fix(Editor): add x').errors[0]).toMatch(/scope "Editor"/);
    expect(lintCommit('fix: add x.').errors).toEqual(['The subject must not end with a period.']);
    expect(lintCommit('fix: ').errors).toContain('The subject after "type(scope): " is empty.');
    expect(lintCommit('fix:add x').errors).toEqual([
      'Put a space after the colon: "type(scope): subject".',
    ]);
    expect(lintCommit(`fix: ${'x'.repeat(100)}`).errors[0]).toMatch(/105 characters long/);
    expect(lintCommit('   ').errors).toEqual(['The commit message is empty.']);
  });

  it('only warns about style: capitalized subjects, missing blank lines, long body lines', () => {
    const result = lintCommit(`feat: Add x\nbody right away\n${'y'.repeat(120)}`);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(3);
    expect(lintCommit('docs: README badges').warnings).toEqual([]);
    expect(lintCommit(`docs: link\n\nhttps://example.com/${'a'.repeat(120)}`).warnings).toEqual([]);
  });

  it('ignores merges, git reverts and fixups', () => {
    for (const message of [
      "Merge branch 'main' into feat/editor",
      'Merge pull request #4 from someone/branch',
      'Revert "feat: add x"\n\nThis reverts commit abc.',
      'fixup! feat: add x',
      'Initial commit',
    ]) {
      expect(isIgnoredCommit(message), message).toBe(true);
      expect(lintCommit(message)).toMatchObject({ valid: true, ignored: true });
    }
    expect(isIgnoredCommit('feat: merge branch helpers')).toBe(false);
  });
});

describe('cleanMessage', () => {
  it('drops comments, the scissors section and trailing whitespace', () => {
    const raw = [
      'feat: add x  ',
      '',
      'Body',
      '# Please enter the commit message for your changes.',
      '# ------------------------ >8 ------------------------',
      'diff --git a/x b/x',
      '',
    ].join('\r\n');
    expect(cleanMessage(raw)).toBe('feat: add x\n\nBody');
    expect(cleanMessage('; comment\nfix: y', ';')).toBe('fix: y');
  });
});

describe('formatLintResult', () => {
  it('lists errors and warnings under the header', () => {
    const message = 'Feat: Add x';
    expect(formatLintResult('abc1234', message, lintCommit(message))).toBe(
      [
        '✖ abc1234: Feat: Add x',
        '    error: The type must be lowercase: "feat", not "Feat".',
        '    warning: Start the subject with a lowercase letter ("add x") unless it begins with a name.',
      ].join('\n'),
    );
  });
});
