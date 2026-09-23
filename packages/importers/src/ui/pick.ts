import { importFileFromBlob, normalizeImportPath, type ImportFile } from '@tessera/core';

/** Wraps a picked or dropped file, or returns null when its path is unsafe. */
function wrap(path: string, file: File): ImportFile | null {
  if (!normalizeImportPath(path)) return null;
  return importFileFromBlob(path, file, file.lastModified);
}

/**
 * Files from an `<input type="file">`: folder pickers (`webkitdirectory`) give each file its path
 * inside the folder, so the folder name comes along as the common root.
 */
export function filesFromInput(list: FileList | readonly File[]): ImportFile[] {
  const files: ImportFile[] = [];
  for (const file of Array.from(list)) {
    const wrapped = wrap(file.webkitRelativePath || file.name, file);
    if (wrapped) files.push(wrapped);
  }
  return files;
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function isDirectory(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function isFile(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

async function collect(entry: FileSystemEntry, files: ImportFile[]): Promise<void> {
  if (isFile(entry)) {
    // Entry paths start at the drop (`/Vault/Note.md`); imports use relative paths.
    const wrapped = wrap(entry.fullPath.replace(/^\/+/, ''), await fileOf(entry));
    if (wrapped) files.push(wrapped);
    return;
  }
  if (!isDirectory(entry)) return;
  const reader = entry.createReader();
  // `readEntries` returns at most 100 entries per call; read until it returns none.
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await collect(child, files);
  }
}

/**
 * Files from a drop: folders are walked recursively (their names become the paths' first
 * segment). Entries must be taken while the drop event runs, so call this from the handler.
 */
export function filesFromDrop(transfer: DataTransfer): Promise<ImportFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }
  if (!entries.length) return Promise.resolve(filesFromInput(transfer.files));
  return (async () => {
    const files: ImportFile[] = [];
    for (const entry of entries) await collect(entry, files);
    return files;
  })();
}

/** True when a drag carries files (not text or links). */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types).includes('Files');
}
