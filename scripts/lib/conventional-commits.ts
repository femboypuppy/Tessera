/**
 * Conventional Commits (https://www.conventionalcommits.org): parsing and linting, shared by the
 * commit-msg hook, the CI check and the changelog generator. No dependencies, so it runs with
 * plain `node` in hooks and in CI jobs that skip `pnpm install`.
 *
 * The rules follow `@commitlint/config-conventional`: a known lowercase type, an optional
 * lowercase scope, `!` or a `BREAKING CHANGE:` footer for breaking changes, a subject without a
 * trailing period, and a header of at most 100 characters.
 */

export const COMMIT_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export const MAX_HEADER_LENGTH = 100;
export const MAX_LINE_LENGTH = 100;

export interface CommitFooter {
  token: string;
  value: string;
}

export interface ParsedCommit {
  header: string;
  type: string;
  scope: string | null;
  /** `!` in the header or a `BREAKING CHANGE:` footer. */
  breaking: boolean;
  /** The text of the `BREAKING CHANGE:` footer, if any. */
  breakingNote: string | null;
  subject: string;
  body: string;
  footers: CommitFooter[];
}

export interface LintResult {
  /** No errors (warnings are allowed). */
  valid: boolean;
  /** Merge commits, git's own revert messages and fixup commits are not checked. */
  ignored: boolean;
  errors: string[];
  warnings: string[];
  parsed: ParsedCommit | null;
}

// The space after the colon is optional here so that lintCommit can name the problem precisely.
const HEADER = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()\r\n]*)\))?(?<breaking>!)?: ?(?<subject>.*)$/;
const SCOPE = /^[a-z0-9][a-z0-9._/-]*(?:, ?[a-z0-9][a-z0-9._/-]*)*$/;
const FOOTER = /^(?<token>BREAKING[ -]CHANGE|[A-Za-z][A-Za-z0-9-]*)(?:: | #)(?<value>.*)$/;
const IGNORED = [
  /^Merge pull request #\d+/,
  /^Merge (?:remote-tracking )?branch\b/,
  /^Merge tag\b/,
  /^Merge .+ into .+/,
  /^Revert ".*"/,
  /^(?:fixup|squash|amend)! /,
  /^Initial commit$/i,
  /^Auto-merged .+ into .+/,
  /^Automatic merge\b/,
];

/**
 * Removes what git strips before committing: comment lines (with `commentChar`), everything
 * after the `git commit -v` scissors line, and surrounding blank lines.
 */
export function cleanMessage(raw: string, commentChar = '#'): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const scissors = lines.findIndex(
    (line) => line === `${commentChar} ------------------------ >8 ------------------------`,
  );
  const kept = (scissors >= 0 ? lines.slice(0, scissors) : lines).filter(
    (line) => !line.startsWith(commentChar),
  );
  return kept
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/** True for messages that are not checked: merges, git's revert messages, fixup commits. */
export function isIgnoredCommit(message: string): boolean {
  const header = message.trim().split('\n', 1)[0] ?? '';
  return IGNORED.some((pattern) => pattern.test(header));
}

/** Splits the message after the header into body and footers (the last paragraph, if every line is a footer or a continuation of one). */
function splitBodyAndFooters(rest: string): { body: string; footers: CommitFooter[] } {
  const paragraphs = rest.split(/\n{2,}/);
  const last = paragraphs.at(-1) ?? '';
  const lines = last.split('\n');
  const footers: CommitFooter[] = [];
  let isFooterBlock = lines.length > 0 && FOOTER.test(lines[0] ?? '');
  if (isFooterBlock) {
    for (const line of lines) {
      const match = FOOTER.exec(line);
      if (match?.groups) {
        footers.push({ token: match.groups.token ?? '', value: match.groups.value ?? '' });
      } else if (footers.length && /^\s+\S/.test(line)) {
        const previous = footers[footers.length - 1];
        if (previous) previous.value += `\n${line.trim()}`;
      } else {
        isFooterBlock = false;
        break;
      }
    }
  }
  if (!isFooterBlock) return { body: rest.trim(), footers: [] };
  return { body: paragraphs.slice(0, -1).join('\n\n').trim(), footers };
}

/** Parses a commit message, or returns null when the header is not `type(scope)!: subject`. */
export function parseCommit(message: string): ParsedCommit | null {
  const text = message.replace(/\r\n/g, '\n').trim();
  const newline = text.indexOf('\n');
  const header = newline < 0 ? text : text.slice(0, newline);
  const match = HEADER.exec(header);
  if (!match?.groups) return null;
  const rest = newline < 0 ? '' : text.slice(newline + 1).replace(/^\n+/, '');
  const { body, footers } = splitBodyAndFooters(rest);
  const breakingFooter = footers.find((footer) => /^BREAKING[ -]CHANGE$/.test(footer.token));
  return {
    header,
    type: match.groups.type ?? '',
    scope: match.groups.scope ?? null,
    breaking: Boolean(match.groups.breaking) || Boolean(breakingFooter),
    breakingNote: breakingFooter?.value ?? null,
    subject: (match.groups.subject ?? '').trim(),
    body,
    footers,
  };
}

const EXAMPLE = 'feat(editor): add a slash menu';

/**
 * Checks a commit message (or a pull request title). Pass the message as git would store it
 * (use {@link cleanMessage} on a raw commit-msg file first).
 *
 * @example
 * lintCommit('feat(editor): add a slash menu').valid; // true
 * lintCommit('Added stuff.').errors; // ['The first line must look like …']
 */
export function lintCommit(message: string): LintResult {
  const text = message.replace(/\r\n/g, '\n').trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!text) {
    return {
      valid: false,
      ignored: false,
      errors: ['The commit message is empty.'],
      warnings,
      parsed: null,
    };
  }
  if (isIgnoredCommit(text)) return { valid: true, ignored: true, errors, warnings, parsed: null };

  const lines = text.split('\n');
  const header = lines[0] ?? '';
  const parsed = parseCommit(text);
  if (!parsed) {
    errors.push(
      `The first line must look like "type(scope): subject", for example "${EXAMPLE}" (the scope is optional). Got "${header}".`,
    );
    return { valid: false, ignored: false, errors, warnings, parsed: null };
  }

  if (!(COMMIT_TYPES as readonly string[]).includes(parsed.type)) {
    const lower = parsed.type.toLowerCase();
    errors.push(
      (COMMIT_TYPES as readonly string[]).includes(lower)
        ? `The type must be lowercase: "${lower}", not "${parsed.type}".`
        : `Unknown type "${parsed.type}". Use one of: ${COMMIT_TYPES.join(', ')}.`,
    );
  }
  if (parsed.scope !== null && !SCOPE.test(parsed.scope)) {
    errors.push(
      `The scope "${parsed.scope}" must be lowercase letters, digits, ".", "_", "/" or "-" (for example "editor" or "deps-dev").`,
    );
  }
  if (!parsed.subject) errors.push('The subject after "type(scope): " is empty.');
  else if (!/^[A-Za-z]+(?:\([^()]*\))?!?: /.test(header)) {
    errors.push('Put a space after the colon: "type(scope): subject".');
  }
  if (/[.。]$/.test(parsed.subject)) errors.push('The subject must not end with a period.');
  if (header.length > MAX_HEADER_LENGTH) {
    errors.push(
      `The first line is ${header.length} characters long; keep it to ${MAX_HEADER_LENGTH}.`,
    );
  }
  if (/^[A-Z][a-z]+(?:\s|$)/.test(parsed.subject)) {
    warnings.push(
      `Start the subject with a lowercase letter ("${parsed.subject.charAt(0).toLowerCase()}${parsed.subject.slice(1)}") unless it begins with a name.`,
    );
  }
  if (lines.length > 1 && lines[1] !== '') {
    warnings.push('Leave a blank line between the first line and the body.');
  }
  const longLines = lines
    .slice(1)
    .filter((line) => line.length > MAX_LINE_LENGTH && !/https?:\/\/\S{20,}/.test(line));
  if (longLines.length) {
    warnings.push(
      `${longLines.length} body line(s) are longer than ${MAX_LINE_LENGTH} characters; wrap them.`,
    );
  }
  return { valid: errors.length === 0, ignored: false, errors, warnings, parsed };
}

/** A readable report for one message: `label` (a commit SHA or "PR title") and its problems. */
export function formatLintResult(label: string, message: string, result: LintResult): string {
  const header = message.trim().split('\n', 1)[0] ?? '';
  const lines = [`${result.valid ? '✔' : '✖'} ${label}: ${header}`];
  for (const error of result.errors) lines.push(`    error: ${error}`);
  for (const warning of result.warnings) lines.push(`    warning: ${warning}`);
  return lines.join('\n');
}
