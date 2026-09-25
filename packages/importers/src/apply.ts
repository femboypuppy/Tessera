import {
  addProperty,
  addRows,
  AbortError,
  createPages,
  findSelectOption,
  getProperty,
  isStoredPropertyType,
  normalizeDocJSON,
  setPageProps,
  throwIfAborted,
  toError,
  validatePropertyValue,
  writeDocJSON,
  type AddPropertyInput,
  type AddRowsInput,
  type CreatePagesInput,
  type DocHandle,
  type ImportContext,
  type ImportProgress,
  type JsonValue,
  type PropertyDefinition,
  type TransferIssue,
} from '@tessera/core';
import * as Y from 'yjs';
import { suggestOptionColor } from './option-colors';
import type { ImportPlan, PlanCellValue, PlanPage } from './plan/types';

/** Transaction origin of everything an import writes. */
export const IMPORT_ORIGIN = 'import';

/** How long the main thread works before letting the page render (ms). */
const SLICE_MS = 12;

/**
 * Pages created per `createPages` call. Each call indexes the workspace once (O(pages so far)), so
 * batches keep the whole import linear while each one stays short enough to keep the UI rendering.
 */
const PAGE_BATCH = 50;

/**
 * Lets the browser render and handle input before the next slice of work. A message queues behind
 * the tasks already waiting (React's renders use messages too), so the UI keeps up. Not
 * `scheduler.yield()`: its continuation runs *before* waiting tasks, which starved the progress
 * dialog of every render for the whole import.
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Writes a page's content and properties the way a synced change arrives: built in a scratch doc,
 * then applied as one update. The runtime "touches" pages after local edits (updated time and
 * author become now and the current user); an import is not an edit, so the source's times stay,
 * and 2,000 pages do not cost 2,000 more workspace transactions.
 */
function writeContent(
  target: Y.Doc,
  doc: PlanPage['doc'] | undefined,
  props: PlanPage['props'] | undefined,
): void {
  const scratch = new Y.Doc();
  try {
    scratch.transact(() => {
      if (doc) writeDocJSON(scratch, normalizeDocJSON(doc), { origin: IMPORT_ORIGIN });
      if (props) setPageProps(scratch, props);
    }, IMPORT_ORIGIN);
    Y.applyUpdate(target, Y.encodeStateAsUpdate(scratch), IMPORT_ORIGIN);
  } finally {
    scratch.destroy();
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** What applying a plan created. */
export interface ApplyResult {
  rootPageId: string;
  pages: number;
  databases: number;
  rows: number;
  issues: TransferIssue[];
  cancelled: boolean;
}

interface DatabaseState {
  handle: DocHandle;
  propertyIds: Map<string, string>;
  properties: Map<string, PropertyDefinition>;
}

/**
 * Creates what a plan describes under a new root page: the page tree (in batched transactions),
 * databases with their columns and rows, then every page's content. Work is sliced so the page
 * keeps rendering; `signal` stops it between slices, and whatever was created stays (under the
 * root page), with `cancelled` set.
 */
export async function applyPlan(
  plan: ImportPlan,
  context: ImportContext,
  options: {
    viewName: string;
    onProgress: (progress: ImportProgress) => void;
    signal: AbortSignal;
  },
): Promise<ApplyResult> {
  const { signal, onProgress } = options;
  const ws = context.workspace.doc;
  const mutation = { userId: context.currentUser.id, origin: IMPORT_ORIGIN };
  const root = context.workspace.createPage({
    title: context.rootTitle,
    parentId: context.parentId,
  });
  const result: ApplyResult = {
    rootPageId: root.id,
    pages: 1,
    databases: 0,
    rows: 0,
    issues: [],
    cancelled: false,
  };
  const byKey = new Map(plan.pages.map((page) => [page.key, page]));
  const idOf = (key: string | null) => (key === null ? root.id : (byKey.get(key)?.id ?? root.id));
  const databases = new Map<string, DatabaseState>();
  const created = new Set<string>();

  const issue = (page: PlanPage, code: string, message: string) => {
    const entry: TransferIssue = { severity: 'warning', code, message, pageId: page.id };
    if (page.source) entry.file = page.source;
    result.issues.push(entry);
  };

  const rowValues = (page: PlanPage, database: DatabaseState): Record<string, JsonValue> => {
    const values: Record<string, JsonValue> = {};
    for (const [key, cell] of Object.entries(page.values ?? {})) {
      const propertyId = database.propertyIds.get(key);
      const property = propertyId ? database.properties.get(propertyId) : undefined;
      if (!propertyId || !property || !isStoredPropertyType(property.type)) continue;
      const value = cellValue(cell, property, idOf);
      if (value === null) continue;
      const check = validatePropertyValue(property.type, value);
      if (check.success) values[propertyId] = value;
      else issue(page, 'invalid-value', `"${property.name}" could not be imported: ${check.error}`);
    }
    return values;
  };

  /** Creates a run of pages (no databases) in one transaction, then their rows' entries. */
  const createBatch = (batch: readonly PlanPage[]) => {
    const inputs = batch.map((page) => {
      const input: CreatePagesInput = {
        id: page.id,
        title: page.title,
        parentId: idOf(page.parentKey),
      };
      if (page.icon) input.icon = page.icon;
      if (page.createdAt) input.createdAt = page.createdAt;
      if (page.updatedAt) input.updatedAt = page.updatedAt;
      return input;
    });
    createPages(ws, inputs, mutation);
    for (const page of batch) created.add(page.key);
    result.pages += batch.length;
    const rows = new Map<DatabaseState, AddRowsInput[]>();
    for (const page of batch) {
      const parent = page.parentKey === null ? null : byKey.get(page.parentKey);
      const database = parent?.kind === 'database' ? databases.get(parent.id) : undefined;
      if (!database) continue;
      const list = rows.get(database) ?? [];
      list.push({ id: page.id, values: rowValues(page, database) });
      rows.set(database, list);
    }
    for (const [database, list] of rows) {
      addRows(database.handle.doc, list, mutation);
      result.rows += list.length;
    }
  };

  const createDatabase = async (page: PlanPage) => {
    const input: Parameters<ImportContext['workspace']['createDatabase']>[0] = {
      id: page.id,
      title: page.title,
      parentId: idOf(page.parentKey),
      titlePropertyName: page.database?.titleName ?? 'Name',
      viewName: options.viewName,
    };
    if (page.icon) input.icon = page.icon;
    if (page.createdAt) input.createdAt = page.createdAt;
    if (page.updatedAt) input.updatedAt = page.updatedAt;
    await context.workspace.createDatabase(input);
    created.add(page.key);
    result.pages += 1;
    result.databases += 1;
    const handle = await context.loadDatabaseDoc(page.id);
    const state: DatabaseState = { handle, propertyIds: new Map(), properties: new Map() };
    databases.set(page.id, state);
    for (const property of page.database?.properties ?? []) {
      const definition: AddPropertyInput = { name: property.name, type: property.type };
      if (property.number) definition.number = property.number;
      if (property.options?.length) {
        definition.options = property.options.map((name) => {
          const color = suggestOptionColor(name);
          return color ? { name, color } : { name };
        });
      }
      if (property.type === 'relation') {
        const target = property.relationTargetKey
          ? byKey.get(property.relationTargetKey)
          : undefined;
        definition.relation = { targetDatabaseId: target?.id ?? null, limit: 'many' };
      }
      try {
        const added = addProperty(handle.doc, definition, mutation);
        state.propertyIds.set(property.key, added.id);
        const stored = getProperty(handle.doc, added.id);
        if (stored) state.properties.set(added.id, stored);
      } catch (error) {
        issue(
          page,
          'invalid-property',
          `The column "${property.name}" could not be created: ${toError(error).message}`,
        );
      }
    }
  };

  const total = plan.pages.length;
  try {
    // 1. The page tree, parents first: databases one at a time, other pages in batches.
    let index = 0;
    while (index < total) {
      throwIfAborted(signal);
      const next = plan.pages[index] as PlanPage;
      if (next.kind === 'database') {
        await createDatabase(next);
        index += 1;
      } else {
        const batch: PlanPage[] = [];
        while (index < total && batch.length < PAGE_BATCH) {
          const page = plan.pages[index] as PlanPage;
          if (page.kind === 'database') break;
          batch.push(page);
          index += 1;
        }
        createBatch(batch);
      }
      const current = plan.pages[index - 1];
      onProgress({
        phase: 'pages',
        done: index,
        total,
        ...(current?.source ? { currentFile: current.source } : {}),
      });
      await yieldToEventLoop();
    }
    for (const state of databases.values()) state.handle.release();
    databases.clear();

    // 2. Contents and page props.
    const withContent = plan.pages.filter((page) => page.doc || page.props);
    const writes: Array<{
      id: string;
      page?: PlanPage;
      doc?: PlanPage['doc'];
      props?: PlanPage['props'];
    }> = [];
    if (plan.rootDoc) writes.push({ id: root.id, doc: plan.rootDoc });
    for (const page of withContent)
      writes.push({ id: page.id, page, doc: page.doc, props: page.props });
    let started = now();
    for (const [position, write] of writes.entries()) {
      throwIfAborted(signal);
      const handle = await context.loadPageDoc(write.id);
      try {
        writeContent(handle.doc, write.doc, write.props);
      } catch (error) {
        if (write.page)
          issue(
            write.page,
            'write-failed',
            `The page content could not be written: ${toError(error).message}`,
          );
      } finally {
        handle.release();
      }
      if (now() - started > SLICE_MS) {
        const source = write.page?.source;
        onProgress({
          phase: 'finishing',
          done: position + 1,
          total: writes.length,
          ...(source ? { currentFile: source } : {}),
        });
        await yieldToEventLoop();
        started = now();
      }
    }
    onProgress({ phase: 'finishing', done: writes.length, total: writes.length });
  } catch (error) {
    if (!(error instanceof AbortError)) throw error;
    result.cancelled = true;
  } finally {
    for (const state of databases.values()) state.handle.release();
  }
  return result;
}

/** A plan cell as a stored value (option names become option IDs, page keys become page IDs). */
function cellValue(
  cell: PlanCellValue,
  property: PropertyDefinition,
  idOf: (key: string | null) => string,
): JsonValue | null {
  switch (cell.type) {
    case 'select':
      return property.type === 'select'
        ? (findSelectOption(property, cell.value)?.id ?? null)
        : cell.value;
    case 'multiSelect': {
      if (property.type !== 'multiSelect') return cell.value.join(', ');
      const ids = cell.value
        .map((name) => findSelectOption(property, name)?.id)
        .filter((id): id is string => Boolean(id));
      return ids.length ? [...new Set(ids)] : null;
    }
    case 'relation':
      return cell.value.map((key) => idOf(key));
    case 'date':
      return { ...cell.value } as JsonValue;
    default:
      return cell.value;
  }
}
