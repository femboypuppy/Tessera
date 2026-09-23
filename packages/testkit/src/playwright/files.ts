/**
 * Files for import and export tests: write a generated markdown folder as a zip or a folder to
 * upload, and read back a downloaded zip.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { GeneratedFile } from '../generator';

/** A new temporary folder (the OS cleans it up; tests may also delete it). */
export function temporaryFolder(prefix = 'tessera-e2e-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Writes files into a zip archive and returns its path. */
export function writeZip(
  files: readonly GeneratedFile[],
  file = path.join(temporaryFolder(), 'import.zip'),
): string {
  const entries: Record<string, Uint8Array> = {};
  for (const entry of files) entries[entry.path] = strToU8(entry.content);
  writeFileSync(file, zipSync(entries, { level: 6, mtime: new Date('2026-01-15T09:00:00Z') }));
  return file;
}

/** Writes files into a folder (for directory uploads) and returns the folder. */
export function writeFolder(files: readonly GeneratedFile[], folder = temporaryFolder()): string {
  for (const entry of files) {
    const target = path.join(folder, ...entry.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.content);
  }
  return folder;
}

/** The text files of a zip archive, by path. */
export function readZip(file: string): Map<string, string> {
  const entries = unzipSync(new Uint8Array(readFileSync(file)));
  return new Map(Object.entries(entries).map(([name, bytes]) => [name, strFromU8(bytes)]));
}
