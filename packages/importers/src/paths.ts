/** Small path helpers for normalized import paths (`/`-separated, relative, no `..`). */

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/** Lower-case extension without the dot (`''` when there is none). */
export function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : '';
}

/** The path without its extension. */
export function stripExtension(path: string): string {
  const ext = extension(path);
  return ext ? path.slice(0, -(ext.length + 1)) : path;
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

/**
 * Resolves `relative` against the folder `from` (both import paths). Returns null when the result
 * would leave the import (more `..` than folders).
 *
 * @example
 * resolveRelative('Notes/Daily', '../Projects/Plan.md'); // 'Notes/Projects/Plan.md'
 */
export function resolveRelative(from: string, relative: string): string | null {
  const segments = from ? from.split('/') : [];
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.length ? segments.join('/') : null;
}

/** Decodes `%20`-style escapes, leaving malformed input as it is. */
export function safeDecodeURI(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural, case-insensitive order ("Note 2" before "Note 10"), stable on ties. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Folders and files that never hold notes: app settings, trash, version control, OS litter. */
const IGNORED_SEGMENTS = new Set([
  '.obsidian',
  '.trash',
  '.git',
  '.github',
  'node_modules',
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

/** True for paths inside ignored folders, or hidden files. */
export function isIgnoredPath(path: string): boolean {
  return path
    .split('/')
    .some(
      (segment) =>
        IGNORED_SEGMENTS.has(segment) || segment.startsWith('.') || segment.startsWith('._'),
    );
}

/** The 32-hex-digit IDs Notion appends to exported names (`Page 1a2b…f.md`). */
const NOTION_ID = /[ _-]?([0-9a-f]{32})$/i;

/** Splits a Notion export name into the title and the Notion ID. */
export function splitNotionName(name: string): { title: string; notionId: string | null } {
  const match = NOTION_ID.exec(name);
  if (!match?.[1] || match.index === 0) return { title: name, notionId: null };
  return { title: name.slice(0, match.index).trim(), notionId: match[1].toLowerCase() };
}

/** Finds a Notion ID in a URL or a path (`https://www.notion.so/Page-1a2b…`, or a dashed UUID). */
export function findNotionId(value: string): string | null {
  const uuid = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/i.exec(
    value,
  );
  if (uuid) return uuid.slice(1).join('').toLowerCase();
  const match = /(?:^|[^0-9a-f])([0-9a-f]{32})(?![0-9a-f])/i.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  canvas: 'application/json',
  excalidraw: 'application/json',
};

/** MIME type from a file name (for attachments whose type the browser does not know). */
export function mimeTypeOf(path: string): string {
  return MIME_TYPES[extension(path)] ?? 'application/octet-stream';
}

export const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'ico',
]);
export const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);
