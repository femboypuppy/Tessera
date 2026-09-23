import {
  AbortError,
  extractAssetIds,
  getPageProps,
  listProperties,
  listRows,
  readDocJSON,
  resolveRows,
  throwIfAborted,
  toError,
  type ExportContext,
  type ExportProgress,
  type ExportResult,
  type ExportScope,
  type ExportSink,
  type JsonValue,
  type PageMeta,
  type TransferIssue,
} from '@tessera/core';
import { createMarkdownCodec, encodePath } from '@tessera/markdown';
import { writeCsv } from '../csv';
import { formatCell } from './csv-values';
import { fileNameFor, NameAllocator, relativePath, splitExtension } from './names';

/** Options of the markdown export. */
export interface MarkdownExportOptions {
  /** `wikilink` (Obsidian, the default) or `markdown` (relative `[text](path.md)` links). */
  linkStyle?: 'wikilink' | 'markdown';
  /** Folder for attachments, relative to the export root. */
  attachmentsFolder?: string;
}

interface Item {
  page: PageMeta;
  /** Path without extension, relative to the export root. */
  path: string;
  /** File written for the page: `path.md`, or `path.csv` for databases. */
  file: string;
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * Exports pages as an Obsidian-compatible folder of markdown: one `.md` per page (children in a
 * folder named like it), frontmatter for properties, attachments in one folder, links as
 * `[[wikilinks]]` (or relative markdown links), and databases as CSV next to a folder of row
 * pages. Written to any `ExportSink`: a zip, a folder (the desktop mirror) or memory.
 */
export async function exportMarkdown(
  scope: ExportScope,
  context: ExportContext,
  sink: ExportSink,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal,
  exporterId: string,
  options: MarkdownExportOptions = {},
): Promise<ExportResult> {
  const started = Date.now();
  const issues: TransferIssue[] = [];
  const linkStyle = options.linkStyle ?? 'wikilink';
  const attachmentsFolder = options.attachmentsFolder ?? 'attachments';
  // The codec is synchronous and deterministic; its own instance keeps exports independent of
  // whichever codec the app resolved.
  const codec = createMarkdownCodec();
  const snapshot = context.workspace.pages.getSnapshot();

  // 1. Every page in scope gets a path. Rows live in their database's folder.
  const items: Item[] = [];
  const byId = new Map<string, Item>();
  const assign = (pages: readonly PageMeta[], folder: string, recurse: boolean) => {
    const names = new NameAllocator();
    for (const page of pages) {
      const name = names.take(fileNameFor(page.title));
      const path = folder ? `${folder}/${name}` : name;
      const item: Item = { page, path, file: `${path}.${page.kind === 'database' ? 'csv' : 'md'}` };
      items.push(item);
      byId.set(page.id, item);
      if (page.kind === 'database') {
        const rows = snapshot
          .children(page.id, { includeRows: true })
          .filter((child) => snapshot.isRow(child.id));
        assign(rows, path, true);
      } else if (recurse) {
        assign(snapshot.children(page.id), path, true);
      }
    }
  };
  if (scope.kind === 'workspace') assign(snapshot.children(null), '', true);
  else {
    const page = snapshot.get(scope.pageId);
    if (page) assign([page], '', scope.kind === 'subtree');
  }

  // 2. Link targets: a page's name when it is unique in the export, else its path (Obsidian's
  // "shortest path when possible").
  const stemCounts = new Map<string, number>();
  for (const item of items) {
    const stem = item.file
      .slice(item.file.lastIndexOf('/') + 1)
      .replace(/\.md$/, '')
      .toLowerCase();
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  const wikiTarget = (item: Item) => {
    const stem = item.file.slice(item.file.lastIndexOf('/') + 1).replace(/\.md$/, '');
    return (stemCounts.get(stem.toLowerCase()) ?? 0) > 1
      ? item.file
      : `${stem}${item.file.endsWith('.md') ? '.md' : ''}`;
  };

  // 3. Attachments, named after their original files.
  const attachmentNames = new NameAllocator();
  const attachmentPaths = new Map<string, string>();
  const allocateAttachments = async (assetIds: readonly string[]) => {
    for (const assetId of assetIds) {
      if (attachmentPaths.has(assetId)) continue;
      const info = await context.assets.getInfo?.(assetId);
      const { stem, extension } = splitExtension(fileNameFor(info?.name ?? assetId, assetId));
      attachmentPaths.set(
        assetId,
        `${attachmentsFolder}/${attachmentNames.take(stem)}${extension}`,
      );
    }
  };

  const titleOf = (pageId: string) => snapshot.get(pageId)?.title ?? '';
  const resolverFor = (item: Item) => ({
    resolvePage: (pageId: string) => {
      const target = byId.get(pageId);
      const title = titleOf(pageId) || 'Untitled';
      if (!target) return snapshot.get(pageId) ? { title } : null;
      const path =
        linkStyle === 'markdown'
          ? relativePath(folderOf(item.file), target.file)
          : wikiTarget(target);
      return { title, path };
    },
    resolveAssetPath: (assetId: string) => {
      const path = attachmentPaths.get(assetId);
      if (!path) return null;
      // Wikilink embeds are vault paths; markdown images are relative to the note.
      return linkStyle === 'markdown' ? relativePath(folderOf(item.file), path) : path;
    },
  });

  let written = 0;
  const total = items.length;
  try {
    for (const [index, item] of items.entries()) {
      throwIfAborted(signal);
      onProgress({ done: index, total, currentPage: item.page.title });
      try {
        if (item.page.kind === 'database') await writeDatabase(item);
        else await writePage(item);
        written += 1;
      } catch (error) {
        if (error instanceof AbortError) throw error;
        issues.push({
          severity: 'error',
          code: 'export-failed',
          message: toError(error).message,
          pageId: item.page.id,
        });
      }
    }
    for (const [assetId, path] of attachmentPaths) {
      throwIfAborted(signal);
      const blob = await context.assets.get(assetId);
      if (!blob) {
        issues.push({
          severity: 'warning',
          code: 'missing-attachment',
          message: 'An attachment is missing from this workspace',
          file: path,
        });
        continue;
      }
      await sink.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      written += 1;
    }
  } catch (error) {
    if (!(error instanceof AbortError)) throw error;
    issues.push({ severity: 'warning', code: 'cancelled', message: 'The export was cancelled' });
  }
  onProgress({ done: total, total });
  return { exporterId, files: written, issues, durationMs: Date.now() - started };

  async function writePage(item: Item) {
    const handle = await context.loadPageDoc(item.page.id);
    let doc;
    let props;
    try {
      doc = readDocJSON(handle.doc);
      props = getPageProps(handle.doc);
    } finally {
      handle.release();
    }
    await allocateAttachments(extractAssetIds(doc));
    const frontmatter: Record<string, JsonValue> = {};
    const name = item.file.slice(item.file.lastIndexOf('/') + 1, -'.md'.length);
    // The title only goes into the frontmatter when the file name could not hold it (including
    // an empty title, written `Untitled.md`).
    if (name !== item.page.title) frontmatter.title = item.page.title;
    if (item.page.icon) frontmatter.icon = item.page.icon;
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) frontmatter[key] = value;
    }
    const markdown = codec.serialize(doc, { linkStyle, frontmatter, ...resolverFor(item) });
    await sink.writeFile(item.file, markdown);
  }

  async function writeDatabase(item: Item) {
    const handle = await context.loadDatabaseDoc(item.page.id);
    try {
      const properties = listProperties(handle.doc).filter(
        (property) => property.type !== 'formula',
      );
      const rows = resolveRows(listRows(handle.doc), snapshot).filter(
        (row) => !row.trashed && !row.missingPage,
      );
      const folder = folderOf(item.file);
      const relationLink = (pageId: string) => {
        const target = byId.get(pageId);
        const title = titleOf(pageId);
        if (!target) return null;
        return `${title.replace(/[,()]/g, ' ').trim() || 'Untitled'} (${encodePath(relativePath(folder, target.file))})`;
      };
      const csv = writeCsv(
        properties.map((property) => property.name),
        rows.map((row) => properties.map((property) => formatCell(row, property, relationLink))),
      );
      await sink.writeFile(item.file, csv);
    } finally {
      handle.release();
    }
  }
}
