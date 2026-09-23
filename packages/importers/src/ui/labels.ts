import type { ImportProgress, TransferIssue } from '@tessera/core';
import { t } from '../i18n';

/** Import phases in the order they run (the progress bar spans all of them). */
export const IMPORT_PHASES: ReadonlyArray<ImportProgress['phase']> = [
  'reading',
  'assets',
  'links',
  'pages',
  'databases',
  'finishing',
];

export function phaseLabel(phase: ImportProgress['phase']): string {
  switch (phase) {
    case 'reading':
      return t('phaseReading');
    case 'links':
      return t('phaseLinks');
    case 'pages':
      return t('phasePages');
    case 'databases':
      return t('phaseDatabases');
    case 'assets':
      return t('phaseAssets');
    case 'finishing':
      return t('phaseFinishing');
  }
}

/** Overall progress from 0 to 1 across the phases. */
export function overallProgress(progress: ImportProgress | null): number {
  if (!progress) return 0;
  const index = Math.max(0, IMPORT_PHASES.indexOf(progress.phase));
  const within = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  return (index + within) / IMPORT_PHASES.length;
}

/** The translated heading of a group of report issues. */
export function issueGroupLabel(code: string): string {
  switch (code) {
    case 'unresolved-link':
      return t('issueUnresolvedLink');
    case 'missing-attachment':
      return t('issueMissingAttachment');
    case 'unsupported-syntax':
      return t('issueUnsupportedSyntax');
    case 'skipped-file':
      return t('issueSkippedFile');
    case 'read-failed':
      return t('issueReadFailed');
    case 'unsafe-path':
      return t('issueUnsafePath');
    case 'duplicate-file':
      return t('issueDuplicateFile');
    case 'unmatched-row':
      return t('issueUnmatchedRow');
    case 'invalid-value':
    case 'invalid-property':
      return t('issueInvalidValue');
    case 'archive-too-large':
      return t('issueArchiveTooLarge');
    case 'restore-failed':
    case 'restore-needs-new-workspace':
      return t('issueRestore');
    default:
      return t('issueOther');
  }
}

export interface IssueGroup {
  label: string;
  severity: TransferIssue['severity'];
  issues: TransferIssue[];
}

/** Groups issues by what they are about, errors first. */
export function groupIssues(issues: readonly TransferIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    if (issue.code === 'cancelled') continue;
    const label = issueGroupLabel(issue.code);
    const key = `${issue.severity}:${label}`;
    const group = groups.get(key) ?? { label, severity: issue.severity, issues: [] };
    group.issues.push(issue);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.severity === 'error') - Number(a.severity === 'error') ||
      b.issues.length - a.issues.length,
  );
}

/** A byte size for people ("1.2 MB"). */
export function formatBytes(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}
