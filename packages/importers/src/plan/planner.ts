import {
  isValidIcon,
  newId,
  normalizeTagName,
  throwIfAborted,
  type AnyNodeJSON,
  type DocJSON,
  type JsonValue,
} from '@tessera/core';
import { createMarkdownCodec, parseFrontmatter } from '@tessera/markdown';
import {
  inferColumn,
  parseCheckboxCell,
  parseCsv,
  parseDateCell,
  parseNumberCell,
  parseRelationCell,
  splitList,
  type InferredColumn,
  type RelationToken,
} from '../csv';
import { commonRootFolder } from '../files';
import {
  basename,
  dirname,
  extension,
  findNotionId,
  IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  naturalCompare,
  splitNotionName,
  stripExtension,
} from '../paths';
import { VaultIndex } from './resolver';
import type {
  ImportPlan,
  PlanAttachment,
  PlanCellValue,
  PlanInput,
  PlanIssue,
  PlanPage,
  PlanProgress,
  PlanProperty,
} from './types';

interface Entry {
  key: string;
  id: string;
  kind: 'note' | 'database' | 'folder';
  /** Path relative to the import (common root folder removed). */
  path: string;
  /** Original path, for the report. */
  source: string;
  text: string;
  lastModified?: number;
  title: string;
  notionId: string | null;
  aliases: string[];
  /** The title came from the document's first heading (Notion), which is then removed. */
  titleFromHeading?: boolean;
  icon?: string;
  createdAt?: number;
  updatedAt?: number;
  parentKey: string | null;
  doc?: DocJSON;
  props?: Record<string, JsonValue>;
  /** Blocks appended to the page (attachments nobody links to). */
  extraBlocks: AnyNodeJSON[];
  /** Database rows: set on row pages. */
  values?: Record<string, PlanCellValue>;
  database?: { titleName: string; properties: PlanProperty[]; rowKeys: string[] };
}

const FRONTMATTER = /^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;

function fold(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function stringList(value: JsonValue | undefined): string[] {
  if (typeof value === 'string')
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  if (Array.isArray(value))
    return value
      .flatMap((item) =>
        typeof item === 'string' || typeof item === 'number' ? [String(item).trim()] : [],
      )
      .filter(Boolean);
  return [];
}

/** A frontmatter date (`created: 2023-01-31`) as epoch milliseconds (earlier than 1970 is fine). */
function timestampOf(value: JsonValue | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const date = parseDateCell(value);
  if (!date) return undefined;
  const time = Date.parse(date.includeTime ? date.start : `${date.start}T00:00:00Z`);
  return Number.isFinite(time) ? time : undefined;
}

/** Page props from frontmatter: `tags` and `aliases` normalized, the rest kept as written. */
function propsFrom(frontmatter: Record<string, JsonValue>): Record<string, JsonValue> {
  const props: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === 'title' || key === 'icon') continue;
    if (key === 'tags' || key === 'tag') {
      const tags = [
        ...new Set(
          stringList(value)
            .flatMap((tag) => tag.split(/\s+/))
            .map((tag) => normalizeTagName(tag))
            .filter((tag): tag is string => tag !== null),
        ),
      ];
      if (tags.length) props.tags = tags;
      continue;
    }
    if (key === 'aliases' || key === 'alias') {
      const aliases = stringList(value);
      if (aliases.length) props.aliases = aliases;
      continue;
    }
    props[key] = value;
  }
  return props;
}

function textOf(node: AnyNodeJSON): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

/** Splits a leading emoji off a title (`🚀 Launch` → icon and `Launch`). */
function splitIcon(title: string): { icon?: string; title: string } {
  const match = /^(\S+)\s+(.+)$/u.exec(title);
  if (
    match?.[1] &&
    match[2] &&
    isValidIcon(match[1]) &&
    /\p{Extended_Pictographic}/u.test(match[1])
  ) {
    return { icon: match[1], title: match[2] };
  }
  return { title };
}

function issueCode(warning: string): string {
  if (warning.startsWith('Unresolved link') || warning.startsWith('Unresolved embed'))
    return 'unresolved-link';
  if (warning.startsWith('Image not found') || warning.startsWith('Attachment not found'))
    return 'missing-attachment';
  return 'unsupported-syntax';
}

function attachmentBlock(attachment: PlanAttachment): AnyNodeJSON {
  if (IMAGE_EXTENSIONS.has(extension(attachment.path))) {
    return {
      type: 'image',
      attrs: { assetId: attachment.assetId, alt: stripExtension(attachment.name) },
    };
  }
  return {
    type: 'embed',
    attrs: {
      kind: 'file',
      ref: attachment.assetId,
      data: { name: attachment.name, size: attachment.size, mimeType: attachment.mimeType },
    },
  };
}

async function breathe(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Turns a folder of notes (Obsidian vault, Notion export, markdown folder) into an import plan:
 * the page tree, every document with its links resolved, databases from CSV files with typed
 * columns, and attachments placed where they belong. Pure and worker-safe: nothing here touches
 * the workspace; `applyPlan` does, on the main thread.
 */
export async function planImport(
  input: PlanInput,
  options: { onProgress?: (progress: PlanProgress) => void; signal?: AbortSignal } = {},
): Promise<ImportPlan> {
  const { format } = input;
  const notion = format === 'notion';
  const codec = createMarkdownCodec();
  const issues: PlanIssue[] = [];
  const skippedFiles = input.ignored.length;
  if (input.ignored.length) {
    issues.push({
      severity: 'warning',
      code: 'skipped-file',
      message: `${input.ignored.length} app settings, trash or hidden files were not imported`,
    });
  }

  // Notion exports a database twice: the current view (`Tasks.csv`) and every property (`Tasks_all.csv`).
  const csvPaths = new Set(
    input.files
      .filter((file) => extension(file.path) === 'csv')
      .map((file) => file.path.toLowerCase()),
  );
  const files = input.files.filter((file) => {
    const ext = extension(file.path);
    if (ext === 'csv') return !csvPaths.has(file.path.toLowerCase().replace(/\.csv$/, '_all.csv'));
    return MARKDOWN_EXTENSIONS.has(ext) || ext === 'txt';
  });
  const root = commonRootFolder([
    ...files.map((file) => file.path),
    ...input.attachments.map((file) => file.path),
  ]);
  const relative = (path: string) => (root ? path.slice(root.length + 1) : path);
  const attachments = input.attachments.map((file) => ({ ...file, path: relative(file.path) }));
  const attachmentByPath = new Map(attachments.map((file) => [file.path, file]));

  // Entries for notes and databases.
  const entries = new Map<string, Entry>();
  const entryByStem = new Map<string, Entry>();
  for (const file of files) {
    const path = relative(file.path).replace(/_all\.csv$/i, '.csv');
    const database = extension(path) === 'csv';
    const name = basename(stripExtension(path));
    const split = notion ? splitNotionName(name) : { title: name, notionId: null };
    const entry: Entry = {
      key: `${database ? 'db' : 'note'}:${path}`,
      id: newId(),
      kind: database ? 'database' : 'note',
      path,
      source: file.path,
      text: file.text,
      title: split.title,
      notionId: split.notionId,
      aliases: [],
      parentKey: null,
      extraBlocks: [],
    };
    if (file.lastModified !== undefined && file.lastModified > 0) {
      entry.createdAt = file.lastModified;
      entry.updatedAt = file.lastModified;
    }
    entries.set(entry.key, entry);
    const stem = fold(stripExtension(path));
    // A database wins its folder over a note with the same name.
    if (!entryByStem.has(stem) || database) entryByStem.set(stem, entry);
  }

  // Folders: a note (or CSV) named like a folder, next to it or inside it, is the folder's page.
  const folders = new Map<string, Entry>();
  const folderOwner = (folder: string): Entry | undefined =>
    entryByStem.get(fold(folder)) ?? entryByStem.get(fold(`${folder}/${basename(folder)}`));
  const folderKey = (folder: string): string | null => {
    if (!folder) return null;
    const owner = folderOwner(folder);
    if (owner) return owner.key;
    let page = folders.get(folder);
    if (!page) {
      const name = basename(folder);
      const split = notion ? splitNotionName(name) : { title: name, notionId: null };
      page = {
        key: `folder:${folder}`,
        id: newId(),
        kind: 'folder',
        path: folder,
        source: root ? `${root}/${folder}` : folder,
        text: '',
        title: split.title,
        notionId: split.notionId,
        aliases: [],
        parentKey: null,
        extraBlocks: [],
      };
      folders.set(folder, page);
      page.parentKey = folderKey(dirname(folder));
    }
    return page.key;
  };
  const parentOf = (path: string): string | null => {
    let folder = dirname(path);
    const owner = folder ? folderOwner(folder) : undefined;
    // `Projects/Projects.md` is the page of `Projects/` itself.
    if (owner && owner.path === path) folder = dirname(folder);
    return folderKey(folder);
  };
  for (const entry of entries.values()) entry.parentKey = parentOf(entry.path);

  // First pass: titles, aliases and icons, which links need before any document is parsed.
  for (const entry of entries.values()) {
    if (entry.kind !== 'note') continue;
    const match = FRONTMATTER.exec(entry.text);
    const frontmatter = match ? parseFrontmatter(match[1] ?? '').data : {};
    if (typeof frontmatter.title === 'string' && frontmatter.title.trim())
      entry.title = frontmatter.title.trim();
    entry.aliases = stringList(frontmatter.aliases ?? frontmatter.alias);
    if (typeof frontmatter.icon === 'string' && isValidIcon(frontmatter.icon))
      entry.icon = frontmatter.icon;
    const created = timestampOf(frontmatter.created ?? frontmatter.date);
    if (created) entry.createdAt = created;
    const updated = timestampOf(frontmatter.updated ?? frontmatter.modified);
    if (updated) entry.updatedAt = updated;
    if (notion) {
      // Notion writes the full title (file names are shortened) as the first heading.
      const heading = /^(?:---[\s\S]*?---\n)?\s*# (.+)$/m.exec(entry.text.slice(0, 2000));
      if (heading?.[1] && entry.text.trimStart().startsWith(`# ${heading[1]}`)) {
        const split = splitIcon(heading[1].trim());
        entry.title = split.title;
        entry.titleFromHeading = true;
        if (split.icon) entry.icon = split.icon;
      }
      if (/^untitled$/i.test(entry.title)) entry.title = '';
    }
  }

  const allEntries = [...entries.values()];
  const index = new VaultIndex(
    allEntries.map((entry) => ({
      key: entry.key,
      path: entry.path,
      kind: entry.kind === 'database' ? 'database' : 'note',
      aliases: entry.aliases,
      notionId: entry.notionId,
    })),
    attachments.map((file) => file.path),
  );
  const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
  const idOf = (key: string | null) => (key ? (entries.get(key)?.id ?? null) : null);
  const referenced = new Set<string>();
  let links = 0;

  const total = allEntries.length;
  let done = 0;
  const progress = (currentFile?: string) => {
    const update: PlanProgress = { done, total };
    if (currentFile) update.currentFile = currentFile;
    options.onProgress?.(update);
  };

  // Second pass: documents.
  for (const entry of allEntries) {
    if (entry.kind !== 'note') continue;
    throwIfAborted(options.signal);
    progress(entry.source);
    const parsed = codec.parse(entry.text, {
      resolvePageLink: (target) => idOf(index.resolvePage(target, entry.path, entry.key)),
      resolveAsset: (path) => {
        const found = index.resolveAttachment(path, entry.path);
        if (!found) return null;
        referenced.add(found);
        return attachmentByPath.get(found)?.assetId ?? null;
      },
      isDatabase: (id) => byId.get(id)?.kind === 'database',
    });
    for (const warning of parsed.warnings) {
      issues.push({
        severity: 'warning',
        code: issueCode(warning),
        message: warning,
        file: entry.source,
        pageKey: entry.key,
      });
    }
    entry.props = propsFrom(parsed.frontmatter);
    entry.doc = parsed.doc;
    done += 1;
    if (done % 25 === 0) await breathe();
  }

  // Databases from CSV files.
  const rowsOf = new Map<string, Entry[]>();
  for (const entry of allEntries) {
    if (
      entry.parentKey &&
      entries.get(entry.parentKey)?.kind === 'database' &&
      entry.kind === 'note'
    ) {
      rowsOf.set(entry.parentKey, [...(rowsOf.get(entry.parentKey) ?? []), entry]);
    }
  }
  const resolveRelation = (token: RelationToken, from: string): string | null => {
    const notionId = findNotionId(token.target);
    if (notionId) {
      const byNotion = allEntries.find((entry) => entry.notionId === notionId);
      if (byNotion) return byNotion.key;
    }
    return /^https?:/i.test(token.target) ? null : index.resolvePage(token.target, from, null);
  };
  for (const database of allEntries) {
    if (database.kind !== 'database') continue;
    throwIfAborted(options.signal);
    progress(database.source);
    const table = parseCsv(database.text);
    const [titleName = 'Name', ...columnNames] = table.headers;
    const columns: InferredColumn[] = columnNames.map((name, column) =>
      inferColumn(
        name,
        table.rows.map((row) => row[column + 1] ?? ''),
        (token) => resolveRelation(token, database.path) !== null,
      ),
    );
    const available = new Map<string, Entry[]>();
    for (const note of rowsOf.get(database.key) ?? []) {
      const title = fold(note.title);
      available.set(title, [...(available.get(title) ?? []), note]);
    }
    const rowKeys: string[] = [];
    table.rows.forEach((row, rowIndex) => {
      const title = row[0] ?? '';
      const matches = available.get(fold(title));
      const note = matches?.shift();
      const rowEntry: Entry = note ?? {
        key: `row:${database.path}:${rowIndex}`,
        id: newId(),
        kind: 'note',
        path: `${stripExtension(database.path)}/${title}`,
        source: database.source,
        text: '',
        title,
        notionId: null,
        aliases: [],
        parentKey: database.key,
        extraBlocks: [],
      };
      if (!note) {
        entries.set(rowEntry.key, rowEntry);
        byId.set(rowEntry.id, rowEntry);
      }
      const split = notion ? splitIcon(title) : { title };
      rowEntry.title = split.title || rowEntry.title;
      if (split.icon) rowEntry.icon = split.icon;
      const values: Record<string, PlanCellValue> = {};
      columns.forEach((column, columnIndex) => {
        const cell = (row[columnIndex + 1] ?? '').trim();
        if (!cell) return;
        switch (column.type) {
          case 'number': {
            const parsed = parseNumberCell(cell);
            if (parsed) values[column.name] = { type: 'number', value: parsed.value };
            break;
          }
          case 'checkbox': {
            const checked = parseCheckboxCell(cell);
            if (checked !== null) values[column.name] = { type: 'checkbox', value: checked };
            break;
          }
          case 'date': {
            const date = parseDateCell(cell);
            if (date) values[column.name] = { type: 'date', value: date };
            break;
          }
          case 'createdTime':
          case 'updatedTime': {
            const date = parseDateCell(cell);
            const time = date ? Date.parse(date.start) : Number.NaN;
            if (Number.isFinite(time)) {
              if (column.type === 'createdTime') rowEntry.createdAt = time;
              else rowEntry.updatedAt = time;
            }
            break;
          }
          case 'select':
            values[column.name] = { type: 'select', value: cell };
            break;
          case 'multiSelect':
            values[column.name] = { type: 'multiSelect', value: splitList(cell) };
            break;
          case 'relation': {
            const keys = (parseRelationCell(cell) ?? [])
              .map((token) => resolveRelation(token, database.path))
              .filter((key): key is string => key !== null);
            if (keys.length) values[column.name] = { type: 'relation', value: [...new Set(keys)] };
            break;
          }
          default:
            values[column.name] = { type: 'text', value: cell };
        }
      });
      // Notion stores each row's properties again at the top of its page: drop that copy.
      if (note?.doc && notion) note.doc = stripPropertyLines(note.doc, [titleName, ...columnNames]);
      rowEntry.values = values;
      rowKeys.push(rowEntry.key);
    });
    // Row pages without a CSV line (edited by hand) still become rows.
    for (const leftovers of available.values()) {
      for (const note of leftovers) {
        rowKeys.push(note.key);
        issues.push({
          severity: 'warning',
          code: 'unmatched-row',
          message: 'This page was not in the database file; it was added as a row without values',
          file: note.source,
          pageKey: note.key,
        });
      }
    }
    const properties: PlanProperty[] = columns.map((column) => {
      const property: PlanProperty = { key: column.name, name: column.name, type: column.type };
      if (column.number) property.number = column.number;
      if (column.options) property.options = column.options;
      if (column.type === 'relation') {
        const targets = new Set<string | null>();
        for (const row of rowKeys) {
          const value = entries.get(row)?.values?.[column.name];
          if (value?.type === 'relation')
            for (const key of value.value) targets.add(entries.get(key)?.parentKey ?? null);
        }
        const [target] = [...targets];
        property.relationTargetKey =
          targets.size === 1 && target && entries.get(target)?.kind === 'database' ? target : null;
      }
      return property;
    });
    database.database = { titleName, properties, rowKeys };
    done += 1;
  }

  // Finish documents: titles, link labels, file sizes, Notion links.
  const titleOf = (id: string) => byId.get(id)?.title ?? null;
  const notionIds = new Map(
    allEntries.filter((entry) => entry.notionId).map((entry) => [entry.notionId, entry.id]),
  );
  for (const entry of allEntries) {
    if (!entry.doc) continue;
    let doc = entry.doc;
    if (format !== 'obsidian')
      doc = stripTitleHeading(doc, entry.title, entry.titleFromHeading === true);
    if (notion) doc = linkNotionUrls(doc, notionIds);
    const finished = finishDoc(doc, titleOf, attachments);
    entry.doc = finished.doc;
    links += finished.links;
  }

  // Attachments nobody links to are kept, as embeds on their folder's page.
  let unreferencedAssets = 0;
  const rootBlocks: AnyNodeJSON[] = [];
  for (const attachment of attachments) {
    if (referenced.has(attachment.path)) continue;
    unreferencedAssets += 1;
    const key = folderKey(dirname(attachment.path));
    const owner = key ? (entries.get(key) ?? folders.get(dirname(attachment.path))) : null;
    const target = owner?.kind === 'database' ? null : owner;
    if (target) target.extraBlocks.push(attachmentBlock(attachment));
    else rootBlocks.push(attachmentBlock(attachment));
  }
  for (const folder of folders.values()) {
    entries.set(folder.key, folder);
  }

  // The page tree, parents first; siblings in natural order, rows in their database's order.
  const children = new Map<string | null, Entry[]>();
  for (const entry of entries.values()) {
    if (entry.kind === 'folder' && !hasContent(entry, entries)) continue;
    children.set(entry.parentKey, [...(children.get(entry.parentKey) ?? []), entry]);
  }
  const pages: PlanPage[] = [];
  const visit = (parentKey: string | null) => {
    const parent = parentKey ? entries.get(parentKey) : undefined;
    const list = children.get(parentKey) ?? [];
    if (parent?.database) {
      const order = new Map(parent.database.rowKeys.map((key, position) => [key, position]));
      list.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
    } else {
      list.sort((a, b) => naturalCompare(a.title, b.title) || naturalCompare(a.path, b.path));
    }
    for (const entry of list) {
      pages.push(toPlanPage(entry));
      visit(entry.key);
    }
  };
  visit(null);
  options.onProgress?.({ done: total, total });
  const plan: ImportPlan = { format, pages, unreferencedAssets, links, issues, skippedFiles };
  if (rootBlocks.length) plan.rootDoc = { type: 'doc', content: rootBlocks } as DocJSON;
  return plan;
}

function hasContent(folder: Entry, entries: Map<string, Entry>): boolean {
  if (folder.extraBlocks.length) return true;
  for (const entry of entries.values()) {
    if (entry.parentKey !== folder.key) continue;
    if (entry.kind !== 'folder' || hasContent(entry, entries)) return true;
  }
  return false;
}

function toPlanPage(entry: Entry): PlanPage {
  const page: PlanPage = {
    key: entry.key,
    id: entry.id,
    parentKey: entry.parentKey,
    kind: entry.kind === 'database' ? 'database' : 'page',
    title: entry.title,
    source: entry.source,
  };
  if (entry.icon) page.icon = entry.icon;
  if (entry.createdAt) page.createdAt = entry.createdAt;
  if (entry.updatedAt) page.updatedAt = entry.updatedAt;
  const content = [...(entry.doc?.content ?? []), ...entry.extraBlocks] as AnyNodeJSON[];
  if (entry.doc || entry.extraBlocks.length) page.doc = { type: 'doc', content } as DocJSON;
  if (entry.props && Object.keys(entry.props).length) page.props = entry.props;
  if (entry.database)
    page.database = { titleName: entry.database.titleName, properties: entry.database.properties };
  if (entry.values) page.values = entry.values;
  return page;
}

/** Removes a first heading that repeats the page title (Notion and plain markdown write one). */
function stripTitleHeading(doc: DocJSON, title: string, always: boolean): DocJSON {
  const [first, ...rest] = doc.content as AnyNodeJSON[];
  if (first?.type !== 'heading' || (first.attrs?.level ?? 1) !== 1) return doc;
  const text = fold(textOf(first));
  if (!always && text !== fold(title) && !text.endsWith(` ${fold(title)}`)) return doc;
  return {
    type: 'doc',
    content: (rest.length ? rest : [{ type: 'paragraph' }]) as DocJSON['content'],
  };
}

/** Drops Notion's `Property: value` lines at the top of a row page. */
function stripPropertyLines(doc: DocJSON, headers: readonly string[]): DocJSON {
  const names = new Set(headers.map(fold));
  const isPropertyLine = (line: string) => {
    const colon = line.indexOf(':');
    return colon > 0 && names.has(fold(line.slice(0, colon)));
  };
  const content = [...(doc.content as AnyNodeJSON[])];
  const first = content[0];
  if (first?.type === 'heading') content.shift();
  while (content[0]?.type === 'paragraph') {
    const lines = textOf(content[0])
      .split('\n')
      .filter((line) => line.trim());
    if (!lines.length || !lines.every(isPropertyLine)) break;
    content.shift();
  }
  if (first?.type === 'heading') content.unshift(first);
  return {
    type: 'doc',
    content: (content.length ? content : [{ type: 'paragraph' }]) as DocJSON['content'],
  };
}

/** Turns links to notion.so pages that were imported into page links. */
function linkNotionUrls(doc: DocJSON, notionIds: Map<string | null, string>): DocJSON {
  const visit = (node: AnyNodeJSON): AnyNodeJSON[] => {
    if (node.type === 'text') {
      const link = node.marks?.find((mark) => mark.type === 'link');
      const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : '';
      if (link && /^https?:\/\/(www\.)?notion\.(so|site)\//i.test(href)) {
        const pageId = notionIds.get(findNotionId(href));
        if (pageId) return [{ type: 'pageLink', attrs: { pageId, label: node.text ?? null } }];
      }
      return [node];
    }
    if (!node.content) return [node];
    return [{ ...node, content: node.content.flatMap(visit) }];
  };
  return {
    type: 'doc',
    content: (doc.content as AnyNodeJSON[]).flatMap(visit) as DocJSON['content'],
  };
}

/** Drops link labels that equal the target's title, fills in file sizes, counts links. */
function finishDoc(
  doc: DocJSON,
  titleOf: (id: string) => string | null,
  attachments: readonly PlanAttachment[],
): { doc: DocJSON; links: number } {
  const byAsset = new Map(attachments.map((file) => [file.assetId, file]));
  let links = 0;
  const visit = (node: AnyNodeJSON): AnyNodeJSON => {
    if (node.type === 'pageLink') {
      links += 1;
      const pageId = typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : '';
      const label = node.attrs?.label;
      const title = titleOf(pageId);
      if (typeof label === 'string' && title !== null && label.trim() === title.trim()) {
        return { ...node, attrs: { ...node.attrs, label: null } };
      }
      return node;
    }
    if (
      node.type === 'embed' &&
      node.attrs?.kind === 'file' &&
      typeof node.attrs.ref === 'string'
    ) {
      const file = byAsset.get(node.attrs.ref);
      if (file)
        return {
          ...node,
          attrs: {
            ...node.attrs,
            data: { name: file.name, size: file.size, mimeType: file.mimeType },
          },
        };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return {
    doc: { type: 'doc', content: (doc.content as AnyNodeJSON[]).map(visit) as DocJSON['content'] },
    links,
  };
}
