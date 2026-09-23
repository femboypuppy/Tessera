import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  defineFeature,
  defineService,
  getPageProps,
  importFileFromBytes,
  SERVICE_PRIORITY,
  listProperties,
  listRows,
  readDocJSON,
  type AnyNodeJSON,
  type AppContext,
  type DocJSON,
  type ImportContext,
  type ImportFile,
  type ImportReport,
  type Importer,
  type PageMeta,
  type PropertyDefinition,
} from '@tessera/core';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { zipSync } from 'fflate';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');

/** Every file of a fixture folder, as `[relative path, bytes]`, sorted. */
export function fixtureEntries(name: string): Array<[string, Uint8Array]> {
  const root = join(FIXTURES, name);
  const entries: Array<[string, Uint8Array]> = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder).sort()) {
      const full = join(folder, entry);
      if (statSync(full).isDirectory()) walk(full);
      else
        entries.push([
          relative(root, full).split(sep).join('/'),
          new Uint8Array(readFileSync(full)),
        ]);
    }
  };
  walk(root);
  return entries;
}

/** A fixture as import files, the way a folder picker gives them (optionally under a folder). */
export function fixtureFiles(name: string, folder?: string): ImportFile[] {
  return fixtureEntries(name).map(([path, bytes]) =>
    importFileFromBytes(folder ? `${folder}/${path}` : path, bytes),
  );
}

/** A zip holding the given entries. */
export function zipEntries(entries: ReadonlyArray<[string, Uint8Array]>): Uint8Array {
  return zipSync(Object.fromEntries(entries));
}

/** A workspace to import into, with the real markdown codec. */
export async function importWorkspace(): Promise<TestAppContext> {
  return createTestAppContext({
    features: [
      defineFeature({
        id: 'markdown-for-tests',
        services: [
          defineService({
            provides: 'markdownCodec',
            id: 'remark',
            priority: SERVICE_PRIORITY.browser,
            create: async () => (await import('@tessera/markdown')).createMarkdownCodec(),
          }),
        ],
      }),
    ],
  });
}

export function importContext(ctx: AppContext, rootTitle = 'Import'): ImportContext {
  return {
    workspace: ctx.workspace,
    loadPageDoc: (id) => ctx.loadPageDoc(id),
    loadDatabaseDoc: (id) => ctx.loadDatabaseDoc(id),
    assets: ctx.services.assetStore,
    codec: ctx.services.markdownCodec,
    parentId: null,
    rootTitle,
    currentUser: ctx.currentUser,
  };
}

/** Runs an importer and returns its report. */
export async function runImporter(
  ctx: AppContext,
  importer: Importer,
  files: readonly ImportFile[],
  rootTitle = 'Import',
  signal: AbortSignal = new AbortController().signal,
): Promise<ImportReport> {
  return importer.run(files, importContext(ctx, rootTitle), () => undefined, signal);
}

/** The imported tree as `title` lines indented by depth (rows included, marked with `·`). */
export function outline(ctx: AppContext, rootId: string): string[] {
  const snapshot = ctx.workspace.pages.getSnapshot();
  const lines: string[] = [];
  const visit = (id: string, depth: number) => {
    const children = snapshot.children(id, { includeRows: true });
    for (const child of children) {
      const row = snapshot.isRow(child.id) ? '· ' : '';
      const kind = child.kind === 'database' ? ' [database]' : '';
      lines.push(
        `${'  '.repeat(depth)}${row}${child.icon ? `${child.icon} ` : ''}${child.title || '(untitled)'}${kind}`,
      );
      visit(child.id, depth + 1);
    }
  };
  visit(rootId, 0);
  return lines;
}

/** Finds an imported page by its title path under the root (`Projects/Launch plan`). */
export function pageAt(ctx: AppContext, rootId: string, titlePath: string): PageMeta {
  const snapshot = ctx.workspace.pages.getSnapshot();
  let current = rootId;
  let page: PageMeta | undefined;
  for (const title of titlePath.split('/')) {
    page = snapshot.children(current, { includeRows: true }).find((child) => child.title === title);
    if (!page) throw new Error(`No page "${title}" in ${titlePath}`);
    current = page.id;
  }
  if (!page) throw new Error(`No page at ${titlePath}`);
  return page;
}

export async function docOf(ctx: AppContext, pageId: string): Promise<DocJSON> {
  const handle = await ctx.loadPageDoc(pageId);
  try {
    return readDocJSON(handle.doc);
  } finally {
    handle.release();
  }
}

export async function propsOf(ctx: AppContext, pageId: string) {
  const handle = await ctx.loadPageDoc(pageId);
  try {
    return getPageProps(handle.doc);
  } finally {
    handle.release();
  }
}

export async function databaseOf(
  ctx: AppContext,
  databaseId: string,
): Promise<{ properties: PropertyDefinition[]; rows: ReturnType<typeof listRows> }> {
  const handle = await ctx.loadDatabaseDoc(databaseId);
  try {
    return { properties: listProperties(handle.doc), rows: listRows(handle.doc) };
  } finally {
    handle.release();
  }
}

/** Every node of a document, depth first. */
export function nodesOf(doc: DocJSON | AnyNodeJSON): AnyNodeJSON[] {
  const result: AnyNodeJSON[] = [];
  const visit = (node: AnyNodeJSON) => {
    result.push(node);
    node.content?.forEach(visit);
  };
  visit(doc as AnyNodeJSON);
  return result;
}

/** Page links of a document, as `{ title, label, heading, blockRef }`. */
export function linksOf(ctx: AppContext, doc: DocJSON) {
  return nodesOf(doc)
    .filter((node) => node.type === 'pageLink')
    .map((node) => {
      const attrs = node.attrs ?? {};
      const target = ctx.workspace.getPage(String(attrs.pageId));
      return {
        title: target?.title ?? '(missing)',
        label: attrs.label ?? null,
        heading: attrs.heading ?? null,
        blockRef: attrs.blockRef ?? null,
      };
    });
}
