import { sanitizeFileName } from '@tessera/core';

/**
 * A page title as a file or folder name that works on every OS and in Obsidian, whose links
 * cannot contain `# ^ [ ] |`. Leading dots would hide the file.
 */
export function fileNameFor(title: string, fallback = 'Untitled'): string {
  const cleaned = sanitizeFileName(title.replace(/[#^[\]|]/g, '-'), fallback).replace(/^\.+/, '');
  return cleaned || fallback;
}

/** Allocates names that are unique within one folder, case-insensitively (`Notes`, `Notes (2)`). */
export class NameAllocator {
  private readonly taken = new Set<string>();

  take(name: string): string {
    let candidate = name;
    for (let n = 2; this.taken.has(candidate.toLowerCase()); n += 1) candidate = `${name} (${n})`;
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }
}

/** Splits a file name into its stem and extension (`photo.final.png` → `photo.final`, `.png`). */
export function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/** A relative path from the folder `from` to the file `to` (both relative to the export root). */
export function relativePath(from: string, to: string): string {
  const fromParts = from ? from.split('/') : [];
  const toParts = to.split('/');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  return [
    ...Array.from({ length: fromParts.length - common }, () => '..'),
    ...toParts.slice(common),
  ].join('/');
}
