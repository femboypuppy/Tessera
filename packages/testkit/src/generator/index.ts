/**
 * The seeded workspace generator. The same options (and seed) always produce the same workspace,
 * byte for byte: realistic titles and text from a bundled word list, random nesting, links with a
 * power-law distribution, tags, tasks, tables, and databases with rows for every property type.
 * Output is Y.Docs built through the core helpers, or a markdown folder.
 *
 * @example
 * const workspace = generateWorkspace({ seed: 42, pages: 5000 });
 * const ws = workspace.workspaceDoc(); // Y.Doc for `ws:<id>`
 * const doc = workspace.pageDoc(workspace.pages[0].id); // Y.Doc for `page:<id>`
 * const files = workspace.markdownFiles(); // [{ path: 'Apollo 11 mission notes.md', content }]
 */
import {
  databaseDocName,
  extractLinks,
  extractTags,
  extractTasks,
  pageDocName,
  workspaceDocName,
  type DocJSON,
} from '@tessera/core';
import * as Y from 'yjs';
import { generatePageContent, largePageEndMarker } from './content';
import { workspaceToMarkdown } from './markdown';
import { planWorkspace, resolveOptions, type WorkspacePlan } from './plan';
import type {
  DatabasePlan,
  GeneratedFile,
  GenerateOptions,
  PagePlan,
  ResolvedOptions,
} from './types';
import { buildDatabaseDoc, buildPageDoc, buildWorkspaceDoc } from './ydocs';

export type {
  DatabasePlan,
  GeneratedFile,
  GenerateOptions,
  PagePlan,
  PageRole,
  PropertyPlan,
  ResolvedOptions,
  RowPlan,
  ViewPlan,
} from './types';
export { DATABASE_TEMPLATES, GENERATED_PROPERTY_TYPES } from './databases';
export { largePageEndMarker } from './content';
export { docToMarkdown, databaseToCsv } from './markdown';
export { Random } from './random';
export { GENERATED_AUTHORS, seededDoc } from './ydocs';
export { TOPICS } from './words';

export interface WorkspaceStats {
  pages: number;
  databases: number;
  rows: number;
  largePages: number;
  trashed: number;
  links: number;
  tags: number;
  tasks: number;
  maxDepth: number;
}

export interface GeneratedWorkspace {
  readonly options: ResolvedOptions;
  /** Every page (ordinary pages, databases, rows, large pages), parents before children. */
  readonly pages: readonly PagePlan[];
  readonly databases: readonly DatabasePlan[];
  page(id: string): PagePlan | undefined;
  /** The page's body as DocJSON, or null for pages without one. Computed once, then cached. */
  content(pageId: string): DocJSON | null;
  /** A new workspace doc (`ws:<workspaceId>`). */
  workspaceDoc(): Y.Doc;
  /** A new page doc, or null for pages without a body. */
  pageDoc(pageId: string): Y.Doc | null;
  /** A new database doc. */
  databaseDoc(databaseId: string): Y.Doc;
  /** Doc names (`ws:…`, `page:…`, `db:…`) this workspace has docs for. */
  docNames(workspaceId: string): string[];
  /** One doc as a Yjs update, or null for names this workspace has no doc for. */
  docUpdate(docName: string, workspaceId: string): Uint8Array | null;
  /** The markdown folder export (pages as `.md`, databases as `.csv`). */
  markdownFiles(): GeneratedFile[];
  /** The text of the last block of a large page (benchmarks wait for it). */
  largePageMarker(pageId: string): string | null;
  /** Counts, computed from the generated content. */
  stats(): WorkspaceStats;
}

/** Generates a workspace. Cheap: only the plan is computed up front; docs are built on demand. */
export function generateWorkspace(options: GenerateOptions = {}): GeneratedWorkspace {
  const plan: WorkspacePlan = planWorkspace(resolveOptions(options));
  const contents = new Map<string, DocJSON | null>();
  const content = (pageId: string): DocJSON | null => {
    if (contents.has(pageId)) return contents.get(pageId) ?? null;
    const page = plan.byId.get(pageId);
    const result = page ? generatePageContent(plan, page) : null;
    contents.set(pageId, result);
    return result;
  };
  const requirePage = (pageId: string) => {
    const page = plan.byId.get(pageId);
    if (!page) throw new Error(`No generated page ${pageId}`);
    return page;
  };
  const pageDoc = (pageId: string): Y.Doc | null => {
    const page = requirePage(pageId);
    const json = content(pageId);
    return json ? buildPageDoc(plan, page, json) : null;
  };
  const databaseDoc = (databaseId: string): Y.Doc => {
    const database = plan.databases.find((candidate) => candidate.id === databaseId);
    if (!database) throw new Error(`No generated database ${databaseId}`);
    return buildDatabaseDoc(plan, database);
  };
  const encode = (doc: Y.Doc) => {
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return update;
  };

  return {
    options: plan.options,
    pages: plan.pages,
    databases: plan.databases,
    page: (id) => plan.byId.get(id),
    content,
    workspaceDoc: () => buildWorkspaceDoc(plan),
    pageDoc,
    databaseDoc,
    docNames(workspaceId) {
      return [
        workspaceDocName(workspaceId),
        ...plan.databases.map((database) => databaseDocName(database.id)),
        ...plan.pages
          .filter((page) => page.role !== 'database' && (page.role !== 'row' || page.hasBody))
          .map((page) => pageDocName(page.id)),
      ];
    },
    docUpdate(docName, workspaceId) {
      if (docName === workspaceDocName(workspaceId)) return encode(buildWorkspaceDoc(plan));
      if (docName.startsWith('db:')) {
        const id = docName.slice(3);
        return plan.databases.some((database) => database.id === id)
          ? encode(databaseDoc(id))
          : null;
      }
      if (docName.startsWith('page:')) {
        const id = docName.slice(5);
        if (!plan.byId.has(id)) return null;
        const doc = pageDoc(id);
        return doc ? encode(doc) : null;
      }
      return null;
    },
    markdownFiles: () => workspaceToMarkdown(plan, (page) => content(page.id)),
    largePageMarker(pageId) {
      const page = plan.byId.get(pageId);
      return page?.role === 'large' ? largePageEndMarker(page) : null;
    },
    stats() {
      let links = 0;
      let tags = 0;
      let tasks = 0;
      for (const page of plan.pages) {
        const json = content(page.id);
        if (!json) continue;
        links += extractLinks(json).length;
        tags += extractTags(json).length;
        tasks += extractTasks(json).length;
      }
      return {
        pages: plan.pages.filter((page) => page.role === 'page').length,
        databases: plan.databases.length,
        rows: plan.pages.filter((page) => page.role === 'row').length,
        largePages: plan.pages.filter((page) => page.role === 'large').length,
        trashed: plan.trashedIds.size,
        links,
        tags,
        tasks,
        maxDepth: Math.max(0, ...plan.pages.map((page) => page.depth)),
      };
    },
  };
}
