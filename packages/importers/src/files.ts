import {
  importFileFromBytes,
  normalizeImportPath,
  throwIfAborted,
  type ImportFile,
  type TransferIssue,
} from '@tessera/core';
import { unzip, type Unzipped } from 'fflate';
import { basename, dirname, extension, joinPath, mimeTypeOf } from './paths';

/** Limits that keep a malicious archive (zip bomb) from exhausting memory. */
const MAX_ENTRIES = 100_000;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ZIP_DEPTH = 4;

export function isZipFile(file: Pick<ImportFile, 'path' | 'mimeType'>): boolean {
  return extension(file.path) === 'zip' || file.mimeType === 'application/zip';
}

function unzipAsync(
  bytes: Uint8Array,
  filter: (name: string, size: number) => boolean,
): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter: (entry) => filter(entry.name, entry.originalSize) }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

/** Result of {@link expandArchives}. */
export interface ExpandedFiles {
  files: ImportFile[];
  issues: TransferIssue[];
  /** Entries that were rejected (unsafe paths, limits). */
  skipped: number;
}

/**
 * Unpacks zip files (recursively: Notion wraps multi-part exports in zips of zips) into import
 * files. Entry names are never trusted: each goes through `normalizeImportPath`, and entries that
 * would escape the import (`..`, absolute or drive paths: "zip slip") are rejected and reported.
 */
export async function expandArchives(
  input: readonly ImportFile[],
  options: { signal?: AbortSignal; onFile?: (path: string) => void } = {},
): Promise<ExpandedFiles> {
  const files: ImportFile[] = [];
  const issues: TransferIssue[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let entries = 0;
  let totalBytes = 0;

  const add = (file: ImportFile) => {
    const key = file.path.toLowerCase();
    if (seen.has(key)) {
      issues.push({
        severity: 'warning',
        code: 'duplicate-file',
        message: 'This path appears twice; the first copy was imported',
        file: file.path,
      });
      skipped += 1;
      return;
    }
    seen.add(key);
    files.push(file);
  };

  const expand = async (file: ImportFile, depth: number): Promise<void> => {
    throwIfAborted(options.signal);
    if (!isZipFile(file)) {
      add(file);
      return;
    }
    if (depth >= MAX_ZIP_DEPTH) {
      issues.push({
        severity: 'warning',
        code: 'skipped-file',
        message: 'Archives nested this deep are not opened',
        file: file.path,
      });
      skipped += 1;
      return;
    }
    options.onFile?.(file.path);
    let unzipped: Unzipped;
    try {
      unzipped = await unzipAsync(await file.bytes(), (name, size) => {
        if (name.endsWith('/')) return false;
        entries += 1;
        totalBytes += size;
        return entries <= MAX_ENTRIES && size <= MAX_ENTRY_BYTES && totalBytes <= MAX_TOTAL_BYTES;
      });
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'read-failed',
        message: `This archive could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        file: file.path,
      });
      return;
    }
    if (entries > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
      issues.push({
        severity: 'error',
        code: 'archive-too-large',
        message: 'The archive is too large; some files were not imported',
        file: file.path,
      });
    }
    // Entries of a nested archive live next to it.
    const prefix = depth === 0 && !dirname(file.path) ? '' : dirname(file.path);
    for (const name of Object.keys(unzipped).sort()) {
      const bytes = unzipped[name];
      if (!bytes) continue;
      const path = normalizeImportPath(joinPath(prefix, name.replace(/\\/g, '/')));
      if (
        !path ||
        /(^|\/)\.\.(\/|$)/.test(name.replace(/\\/g, '/')) ||
        /^([a-zA-Z]:|\/|\\)/.test(name)
      ) {
        issues.push({
          severity: 'error',
          code: 'unsafe-path',
          message: 'Rejected an archive entry whose path leaves the import',
          file: `${basename(file.path)}: ${name.slice(0, 200)}`,
        });
        skipped += 1;
        continue;
      }
      await expand(importFileFromBytes(path, bytes, mimeTypeOf(path)), depth + 1);
    }
  };

  for (const file of input) await expand(file, 0);
  return { files, issues, skipped };
}

/**
 * Lists the entry names of a zip without decompressing it (for format detection), or null when
 * the archive can't be opened (damaged, cut short, or not a zip).
 */
export async function listZipEntries(file: ImportFile): Promise<string[] | null> {
  const names: string[] = [];
  try {
    await unzipAsync(await file.bytes(), (name) => {
      names.push(name);
      return false;
    });
  } catch {
    return null;
  }
  return names;
}

/**
 * Paths of the files, with zips replaced by their entries' names (for detection and the
 * preview), and the zips that could not be opened.
 */
export async function peekFiles(
  files: readonly ImportFile[],
): Promise<{ paths: string[]; unreadable: string[] }> {
  const paths: string[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    if (isZipFile(file)) {
      const names = await listZipEntries(file);
      if (!names) unreadable.push(file.path);
      for (const name of names ?? []) {
        if (isZipFile({ path: name })) paths.push(name.replace(/\.zip$/i, '/'));
        else paths.push(name);
      }
    } else {
      paths.push(file.path);
    }
  }
  return { paths, unreadable };
}

/** Paths of the files, with zips replaced by their entries' names (for detection). */
export async function peekPaths(files: readonly ImportFile[]): Promise<string[]> {
  return (await peekFiles(files)).paths;
}

/**
 * The folder every file shares, if any (a vault picked as a folder or zipped with its folder):
 * `MyVault/a.md` and `MyVault/b/c.md` share `MyVault`.
 */
export function commonRootFolder(paths: readonly string[]): string | null {
  let root: string | null = null;
  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash < 0) return null;
    const first = path.slice(0, slash);
    if (root === null) root = first;
    else if (root !== first) return null;
  }
  return root;
}

/** Reads a file as text: UTF-8, without a byte order mark, with `\n` line endings. */
export async function readText(file: ImportFile): Promise<string> {
  const text = await file.text();
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n');
}
