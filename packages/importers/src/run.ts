import {
  AbortError,
  throwIfAborted,
  toError,
  type ImportContext,
  type ImportFile,
  type ImportProgress,
  type ImportReport,
  type TransferIssue,
} from '@tessera/core';
import { applyPlan, yieldToEventLoop } from './apply';
import { expandArchives, readText } from './files';
import { t } from './i18n';
import { basename, extension, isIgnoredPath, MARKDOWN_EXTENSIONS, mimeTypeOf } from './paths';
import type { PlanAttachment, PlanTextFile, SourceFormat } from './plan/types';
import { planInWorker } from './worker/client';

/** Markdown and CSV files larger than this are skipped (they would not be notes). */
const MAX_TEXT_BYTES = 50 * 1024 * 1024;

function emptyReport(importerId: string): ImportReport {
  return {
    importerId,
    rootPageId: null,
    counts: { pages: 0, databases: 0, rows: 0, assets: 0, links: 0, skippedFiles: 0 },
    issues: [],
    durationMs: 0,
    cancelled: false,
  };
}

function isTextFile(path: string): boolean {
  const ext = extension(path);
  return MARKDOWN_EXTENSIONS.has(ext) || ext === 'csv' || ext === 'txt';
}

/**
 * Runs an import end to end: unpacks archives, stores attachments, plans the import in a worker
 * (parsing and link resolution), then creates the pages under a new root page. Streaming and
 * incremental: progress is reported at every step, `signal` cancels between files, and bad files
 * become report issues instead of errors.
 */
export async function runImport(
  format: SourceFormat,
  importerId: string,
  files: readonly ImportFile[],
  context: ImportContext,
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal,
): Promise<ImportReport> {
  const started = Date.now();
  const report = emptyReport(importerId);
  const issue = (entry: TransferIssue) => report.issues.push(entry);
  try {
    onProgress({ phase: 'reading', done: 0, total: files.length });
    const expanded = await expandArchives(files, {
      signal,
      onFile: (path) =>
        onProgress({ phase: 'reading', done: 0, total: files.length, currentFile: path }),
    });
    report.issues.push(...expanded.issues);
    report.counts.skippedFiles += expanded.skipped;

    const ignored: string[] = [];
    const textFiles: ImportFile[] = [];
    const attachments: ImportFile[] = [];
    for (const file of expanded.files) {
      if (isIgnoredPath(file.path)) ignored.push(file.path);
      else if (isTextFile(file.path)) textFiles.push(file);
      else attachments.push(file);
    }

    const texts: PlanTextFile[] = [];
    for (const [index, file] of textFiles.entries()) {
      throwIfAborted(signal);
      if (index % 50 === 0) {
        onProgress({
          phase: 'reading',
          done: index,
          total: textFiles.length,
          currentFile: file.path,
        });
        await yieldToEventLoop();
      }
      if (file.size > MAX_TEXT_BYTES) {
        issue({
          severity: 'warning',
          code: 'skipped-file',
          message: 'This file is too large to be a note',
          file: file.path,
        });
        report.counts.skippedFiles += 1;
        continue;
      }
      try {
        const text: PlanTextFile = { path: file.path, text: await readText(file) };
        if (file.lastModified !== undefined) text.lastModified = file.lastModified;
        texts.push(text);
      } catch (error) {
        issue({
          severity: 'error',
          code: 'read-failed',
          message: toError(error).message,
          file: file.path,
        });
      }
    }

    const stored: PlanAttachment[] = [];
    for (const [index, file] of attachments.entries()) {
      throwIfAborted(signal);
      onProgress({
        phase: 'assets',
        done: index,
        total: attachments.length,
        currentFile: file.path,
      });
      try {
        const name = basename(file.path);
        const mimeType =
          file.mimeType && file.mimeType !== 'application/octet-stream'
            ? file.mimeType
            : mimeTypeOf(file.path);
        const bytes = await file.bytes();
        const { assetId } = await context.assets.put(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }),
          { name, mimeType },
        );
        stored.push({ path: file.path, assetId, name, size: file.size, mimeType });
        report.counts.assets += 1;
      } catch (error) {
        issue({
          severity: 'error',
          code: 'read-failed',
          message: `The attachment could not be stored: ${toError(error).message}`,
          file: file.path,
        });
      }
    }

    const plan = await planInWorker(
      { format, files: texts, attachments: stored, ignored },
      (progress) => onProgress({ phase: 'links', ...progress }),
      signal,
    );
    report.counts.links = plan.links;
    report.counts.skippedFiles += plan.skippedFiles;

    const applied = await applyPlan(plan, context, {
      viewName: t('tableView'),
      onProgress,
      signal,
    });
    report.rootPageId = applied.rootPageId;
    report.counts.pages = applied.pages;
    report.counts.databases = applied.databases;
    report.counts.rows = applied.rows;
    report.cancelled = applied.cancelled;
    const pageIds = new Map(plan.pages.map((page) => [page.key, page.id]));
    for (const planned of plan.issues) {
      const { pageKey, ...rest } = planned;
      const entry: TransferIssue = { ...rest };
      const pageId = pageKey ? pageIds.get(pageKey) : undefined;
      if (pageId) entry.pageId = pageId;
      issue(entry);
    }
    report.issues.push(...applied.issues);
  } catch (error) {
    if (error instanceof AbortError) report.cancelled = true;
    else issue({ severity: 'error', code: 'import-failed', message: toError(error).message });
  }
  report.durationMs = Date.now() - started;
  return report;
}
