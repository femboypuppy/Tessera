import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Helpers for the docs specs, which check files in the repository rather than the running app. */

export const REPO = fileURLToPath(new URL('../../', import.meta.url));

export function repoPath(relative: string): string {
  return path.join(REPO, ...relative.split('/'));
}

export function readRepoFile(relative: string): string {
  return readFileSync(repoPath(relative), 'utf8');
}

export function repoFileExists(relative: string): boolean {
  return existsSync(repoPath(relative));
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(relative: string): { width: number; height: number } {
  const data = readFileSync(repoPath(relative));
  const signature = data.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error(`${relative} is not a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** The image sizes stored in an .ico file's directory. */
export function icoSizes(relative: string): number[] {
  const data = readFileSync(repoPath(relative));
  if (data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${relative} is not an icon file`);
  }
  const count = data.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => data.readUInt8(6 + index * 16) || 256);
}

/**
 * Screenshot names each agent promises in its agent file ("Screenshots (light and dark): `a`,
 * `b`"), by area. The README may reference these before the feature branches are merged.
 */
export function promisedScreenshots(): Map<string, Set<string>> {
  const files: Record<string, string> = {
    editor: 'agents/02-editor.md',
    sync: 'agents/03-sync.md',
    databases: 'agents/04-databases.md',
    search: 'agents/05-search-graph.md',
    plugins: 'agents/06-plugins.md',
    desktop: 'agents/07-desktop-selfhost.md',
    importers: 'agents/08-importers.md',
  };
  const promised = new Map<string, Set<string>>();
  for (const [area, file] of Object.entries(files)) {
    const line = readRepoFile(file)
      .split('\n')
      .find((text) => text.includes('Screenshots (light and dark)'));
    if (!line) throw new Error(`${file} lists no screenshots`);
    const names = [...line.matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1] ?? '');
    promised.set(area, new Set(names));
  }
  return promised;
}

/** Every link and image target in a markdown file: markdown syntax and HTML attributes. */
export function linkTargets(markdown: string): string[] {
  const withoutCode = markdown.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  const targets = [
    // Any `](target)`, which also catches the outer link of a linked image: [![alt](img)](link).
    ...withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
    ...withoutCode.matchAll(/\b(?:src|href)="([^"]+)"/g),
    ...withoutCode.matchAll(/\bsrcset="([^"\s]+)/g),
    // Link reference definitions ([label]: target), but not footnotes ([^note]: text).
    ...withoutCode.matchAll(/^\[(?!\^)[^\]]+\]:\s*(\S+)/gm),
  ].map((match) => match[1] ?? '');
  return targets.filter((target) => target !== '');
}

/** GitHub's heading anchor for a heading text. */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
