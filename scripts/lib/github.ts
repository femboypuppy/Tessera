/**
 * Small helpers for scripts that also run in GitHub Actions. Plain Node, no dependencies.
 */
import { appendFileSync } from 'node:fs';

/** True inside a GitHub Actions job. */
export function inGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

/** Appends markdown to the job summary when running in GitHub Actions; a no-op elsewhere. */
export function appendJobSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
}

/** Emits a GitHub error annotation in Actions, or a plain error line elsewhere. */
export function annotateError(message: string, title?: string): void {
  if (inGitHubActions()) {
    const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error${title ? ` title=${title}` : ''}::${escaped}`);
  } else {
    console.error(`error: ${message}`);
  }
}
