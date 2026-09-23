import {
  basename,
  dirname,
  extension,
  MARKDOWN_EXTENSIONS,
  naturalCompare,
  resolveRelative,
  safeDecodeURI,
  stripExtension,
} from '../paths';

/** A page a link can point at: a note (markdown file) or a database (CSV file). */
export interface IndexedPage {
  key: string;
  /** Source path, with its extension. */
  path: string;
  kind: 'note' | 'database';
  aliases?: readonly string[];
  notionId?: string | null;
}

function fold(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function depth(path: string): number {
  return path.split('/').length;
}

/**
 * Resolves links the way Obsidian does: paths relative to the linking file or to the vault root,
 * then file names anywhere (case-insensitive; the same folder wins, then the shortest path), then
 * aliases. Markdown-style relative links (`../Notes/Plan.md`, with `%20`) resolve too, and so do
 * Notion IDs in links.
 */
export class VaultIndex {
  private readonly pagesByPath = new Map<string, IndexedPage>();
  private readonly pagesByName = new Map<string, IndexedPage[]>();
  private readonly pagesByAlias = new Map<string, IndexedPage>();
  private readonly pagesByNotionId = new Map<string, IndexedPage>();
  private readonly filesByPath = new Map<string, string>();
  private readonly filesByName = new Map<string, string[]>();
  private readonly pagesByKey = new Map<string, IndexedPage>();

  constructor(pages: readonly IndexedPage[], attachments: readonly string[]) {
    for (const page of pages) {
      this.pagesByKey.set(page.key, page);
      const withoutExtension = fold(stripExtension(page.path));
      // Notes answer to their path without `.md`; databases to theirs with and without `.csv`.
      if (page.kind === 'database') this.pagesByPath.set(fold(page.path), page);
      if (!this.pagesByPath.has(withoutExtension) || page.kind === 'note')
        this.pagesByPath.set(withoutExtension, page);
      const name = fold(basename(stripExtension(page.path)));
      this.pagesByName.set(name, [...(this.pagesByName.get(name) ?? []), page]);
      if (page.kind === 'database') {
        const withExtension = fold(basename(page.path));
        this.pagesByName.set(withExtension, [...(this.pagesByName.get(withExtension) ?? []), page]);
      }
      for (const alias of page.aliases ?? []) {
        const key = fold(alias.trim());
        if (key && !this.pagesByAlias.has(key)) this.pagesByAlias.set(key, page);
      }
      if (page.notionId) this.pagesByNotionId.set(page.notionId, page);
    }
    for (const path of attachments) {
      this.filesByPath.set(fold(path), path);
      const name = fold(basename(path));
      this.filesByName.set(name, [...(this.filesByName.get(name) ?? []), path]);
    }
  }

  page(key: string): IndexedPage | undefined {
    return this.pagesByKey.get(key);
  }

  /** Picks among same-named candidates: the linking file's folder, then the shortest path. */
  private pick<T>(
    candidates: readonly T[],
    pathOf: (item: T) => string,
    from: string,
    suffix: string | null,
  ): T | null {
    let list = [...candidates];
    if (suffix) {
      const needle = `/${suffix}`;
      const matching = list.filter(
        (item) =>
          `/${fold(stripExtension(pathOf(item)))}`.endsWith(needle) ||
          `/${fold(pathOf(item))}`.endsWith(needle),
      );
      if (matching.length) list = matching;
      else return null;
    }
    if (list.length <= 1) return list[0] ?? null;
    const folder = fold(dirname(from));
    const sameFolder = list.filter((item) => fold(dirname(pathOf(item))) === folder);
    if (sameFolder.length) list = sameFolder;
    list.sort(
      (a, b) => depth(pathOf(a)) - depth(pathOf(b)) || naturalCompare(pathOf(a), pathOf(b)),
    );
    return list[0] ?? null;
  }

  private candidatePaths(target: string, from: string): string[] {
    const paths = new Set<string>();
    for (const variant of new Set([target, safeDecodeURI(target)])) {
      const clean = variant.trim().replace(/^\/+/, '');
      if (!clean) continue;
      // Markdown links are relative to the linking file; wikilinks may be too (`./`, `../`).
      const relative = resolveRelative(dirname(from), clean);
      if (relative) paths.add(relative);
      if (!clean.startsWith('.')) paths.add(clean);
    }
    return [...paths];
  }

  /** Resolves a link target (without `#heading` and `|alias`) from the file at `from` to a page key. */
  resolvePage(target: string, from: string, selfKey: string | null): string | null {
    if (!target.trim()) return selfKey;
    // A Notion path names its folders' pages too: the file's own ID is the last one.
    const lastSegment = basename(stripExtension(safeDecodeURI(target.trim())));
    const notionId = /([0-9a-f]{32})$/i.exec(lastSegment)?.[1]?.toLowerCase();
    if (notionId && this.pagesByNotionId.has(notionId))
      return this.pagesByNotionId.get(notionId)?.key ?? null;
    const candidates = this.candidatePaths(target, from);
    for (const path of candidates) {
      // `Plan.md` names a note; `Tasks.csv`, `Tasks` or `Release v1.2` are looked up as written.
      const markdown = MARKDOWN_EXTENSIONS.has(extension(path));
      const found = this.pagesByPath.get(fold(markdown ? stripExtension(path) : path));
      if (found && (!markdown || found.kind === 'note')) return found.key;
    }
    for (const variant of new Set([target, safeDecodeURI(target)])) {
      const clean = variant
        .trim()
        .replace(/^\/+/, '')
        .replace(/^(\.\.?\/)+/, '');
      const ext = extension(clean);
      const stem = MARKDOWN_EXTENSIONS.has(ext) ? stripExtension(clean) : clean;
      const name = fold(basename(stem));
      const byName = this.pagesByName.get(name) ?? [];
      const suffix = stem.includes('/') ? fold(stem) : null;
      const picked = this.pick(byName, (page) => page.path, from, suffix);
      if (picked) return picked.key;
      const alias = this.pagesByAlias.get(fold(clean));
      if (alias) return alias.key;
    }
    return null;
  }

  /** Resolves an attachment path (image, PDF…) from the file at `from` to its import path. */
  resolveAttachment(target: string, from: string): string | null {
    for (const path of this.candidatePaths(target, from)) {
      const exact = this.filesByPath.get(fold(path));
      if (exact) return exact;
    }
    for (const variant of new Set([target, safeDecodeURI(target)])) {
      const clean = variant
        .trim()
        .replace(/^\/+/, '')
        .replace(/^(\.\.?\/)+/, '');
      if (!clean) continue;
      const byName = this.filesByName.get(fold(basename(clean))) ?? [];
      const picked = this.pick(
        byName,
        (path) => path,
        from,
        clean.includes('/') ? fold(clean) : null,
      );
      if (picked) return picked;
    }
    return null;
  }
}
