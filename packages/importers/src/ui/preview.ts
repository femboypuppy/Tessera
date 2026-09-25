import type { ImportFile } from '@tessera/core';
import { commonRootFolder, isZipFile, peekFiles } from '../files';
import { t } from '../i18n';
import { IMPORTER_IDS } from '../importers';
import { basename, extension, isIgnoredPath, MARKDOWN_EXTENSIONS, naturalCompare } from '../paths';

/** One item at the top of the import (after the common root folder). */
export interface PreviewEntry {
  name: string;
  kind: 'folder' | 'note' | 'database' | 'file';
  /** Files inside a folder. */
  files: number;
}

/** What the picked files contain, shown before importing. */
export interface FileSummary {
  /** Files picked or dropped (a zip counts as one). */
  picked: number;
  notes: number;
  databases: number;
  attachments: number;
  folders: number;
  /** App settings, trash and system files that are skipped. */
  ignored: number;
  /** The folder everything is in (a vault's name), if there is one. */
  root: string | null;
  entries: PreviewEntry[];
  /** Zips that could not be opened (damaged, cut short, or not a zip). */
  unreadable: string[];
}

function kindOf(path: string): PreviewEntry['kind'] {
  const ext = extension(path);
  if (MARKDOWN_EXTENSIONS.has(ext) || ext === 'txt') return 'note';
  if (ext === 'csv') return 'database';
  return 'file';
}

/** Summarizes file paths (entries of zips included) for the preview. */
export function summarizePaths(paths: readonly string[], picked = paths.length): FileSummary {
  const kept = paths.filter((path) => !path.endsWith('/'));
  const visible = kept.filter((path) => !isIgnoredPath(path));
  const root = commonRootFolder(visible);
  const strip = (path: string) => (root ? path.slice(root.length + 1) : path);
  const summary: FileSummary = {
    picked,
    notes: 0,
    databases: 0,
    attachments: 0,
    folders: 0,
    ignored: kept.length - visible.length,
    root,
    entries: [],
    unreadable: [],
  };
  const folders = new Set<string>();
  const top = new Map<string, PreviewEntry>();
  // Notion exports each database twice (`Tasks.csv` and `Tasks_all.csv`); count it once.
  const csvs = new Set(visible.filter((path) => extension(path) === 'csv'));
  for (const path of visible) {
    const inner = strip(path);
    const kind = kindOf(inner);
    if (kind === 'note') summary.notes += 1;
    else if (kind === 'database') {
      if (!(/_all\.csv$/i.test(inner) && csvs.has(path.replace(/_all\.csv$/i, '.csv'))))
        summary.databases += 1;
    } else summary.attachments += 1;
    const segments = inner.split('/');
    for (let depth = 1; depth < segments.length; depth += 1)
      folders.add(segments.slice(0, depth).join('/'));
    const [first = inner] = segments;
    const entry = top.get(first) ?? {
      name: first,
      kind: segments.length > 1 ? ('folder' as const) : kind,
      files: 0,
    };
    entry.files += 1;
    top.set(first, entry);
  }
  summary.folders = folders.size;
  // Folders first, then files, in natural order; a Notion database's `_all` twin is hidden.
  summary.entries = [...top.values()]
    .filter(
      (entry) =>
        !(/_all\.csv$/i.test(entry.name) && top.has(entry.name.replace(/_all\.csv$/i, '.csv'))),
    )
    .sort(
      (a, b) =>
        Number(b.kind === 'folder') - Number(a.kind === 'folder') || naturalCompare(a.name, b.name),
    );
  return summary;
}

/** Summarizes picked files, looking inside zips. */
export async function summarizeFiles(files: readonly ImportFile[]): Promise<FileSummary> {
  const { paths, unreadable } = await peekFiles(files);
  const summary = { ...summarizePaths(paths, files.length), unreadable };
  // A single zip without a root folder inside is named after the zip.
  const [only] = files;
  if (!summary.root && files.length === 1 && only && isZipFile(only))
    summary.root = basename(only.path).replace(/\.zip$/i, '');
  return summary;
}

/** The suggested title of the page an import goes under. */
export function suggestRootTitle(importerId: string, label: string, summary: FileSummary): string {
  if (importerId === IMPORTER_IDS.notion) return t('notionRootTitle');
  // Notion-style and "Export-…" archive names say nothing about the content.
  if (summary.root && !/^Export-[0-9a-f-]{8,}/i.test(summary.root)) return summary.root;
  return t('rootTitleFallback', { source: label });
}

/** The workspace name suggested for a restored backup, read from the start of the file. */
export async function suggestWorkspaceName(file: ImportFile): Promise<string> {
  const head = new TextDecoder().decode((await file.bytes()).subarray(0, 4096));
  const match =
    /"workspace"\s*:\s*\{\s*"id"\s*:\s*"[^"]*"\s*,\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head);
  let name = basename(file.path).replace(/\.json$/i, '');
  if (match?.[1] !== undefined) {
    try {
      name = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      // Keep the file name when the name is cut off or malformed.
    }
  }
  return t('restoredWorkspaceName', { name: name.trim() || t('untitled') });
}
