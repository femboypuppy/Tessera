/**
 * Turns a workspace plan into Y.Docs through the core helpers (`createPage`, `trashPage`,
 * `writeDocJSON`, `setPageProps`, `addProperty`, `addView`, `initDatabaseDoc`, `addRow`), so the
 * data is valid by construction.
 *
 * Speed: `createPage` indexes the whole workspace on every call, which is quadratic. So subtrees
 * are created in small scratch docs that hold only their root page, and the scratch docs' updates
 * are merged into the workspace doc: the same data the helpers produce one page at a time. Very
 * large databases get the same treatment in chunks.
 *
 * Determinism: every Y.Doc gets a client ID derived from the seed, so the same seed produces
 * byte-identical updates.
 */
import {
  addProperty,
  addRow,
  addView,
  createPage,
  initDatabaseDoc,
  initWorkspaceDoc,
  setPageProps,
  trashPage,
  writeDocJSON,
  type DocJSON,
} from '@tessera/core';
import * as Y from 'yjs';
import type { WorkspacePlan } from './plan';
import { Random } from './random';
import type { DatabasePlan, PagePlan } from './types';

/** User IDs recorded as `createdBy`/`updatedBy`. */
export const GENERATED_AUTHORS = ['user-ada', 'user-chen', 'user-priya', 'user-mateo'] as const;

const ROW_CHUNK = 400;

/** A new Y.Doc whose client ID depends only on the seed and `label`. */
export function seededDoc(seed: number | string, label: string): Y.Doc {
  const doc = new Y.Doc();
  // Client IDs are unsigned 32-bit integers; 0 is avoided only for readability in dumps.
  doc.clientID = new Random(`${String(seed)}/client/${label}`).uint32() || 1;
  return doc;
}

function authorOf(page: PagePlan): string {
  return GENERATED_AUTHORS[page.index % GENERATED_AUTHORS.length] ?? 'user-ada';
}

function createPlannedPage(doc: Y.Doc, page: PagePlan): void {
  createPage(
    doc,
    {
      id: page.id,
      kind: page.kind,
      title: page.title,
      ...(page.icon ? { icon: page.icon } : {}),
      ...(page.cover ? { cover: page.cover } : {}),
      parentId: page.parentId,
      favorite: page.favorite,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    },
    { now: page.createdAt, userId: authorOf(page) },
  );
}

/** Pages whose subtree is bigger than this are created in a scratch doc of their own. */
const CHUNK_SIZE = 16;

/** The workspace doc (`ws:<id>`): every page's metadata, the tree and the trash. */
export function buildWorkspaceDoc(plan: WorkspacePlan): Y.Doc {
  const seed = plan.options.seed;
  const ws = seededDoc(seed, 'workspace');
  initWorkspaceDoc(ws, { now: plan.pages[0]?.createdAt ?? plan.options.now });

  const children = new Map<string | null, PagePlan[]>();
  for (const page of plan.pages) {
    const list = children.get(page.parentId);
    if (list) list.push(page);
    else children.set(page.parentId, [page]);
  }
  const size = new Map<string, number>();
  for (const page of [...plan.pages].reverse()) {
    const own = (children.get(page.id) ?? []).reduce(
      (sum, child) => sum + (size.get(child.id) ?? 1),
      0,
    );
    size.set(page.id, own + 1);
  }

  /**
   * Creates a page under a client ID of its own, so its update doesn't depend on anything else in
   * `doc` (Yjs needs each client's history from the start) and can seed a scratch doc alone.
   */
  const createStandalone = (doc: Y.Doc, page: PagePlan): Uint8Array => {
    const previous = doc.clientID;
    doc.clientID = seededDoc(seed, `page/${page.id}/meta`).clientID;
    const captured: { update: Uint8Array | null } = { update: null };
    const capture = (update: Uint8Array) => {
      captured.update = update;
    };
    doc.on('update', capture);
    createPlannedPage(doc, page);
    doc.off('update', capture);
    doc.clientID = previous;
    if (!captured.update) throw new Error(`Creating ${page.id} produced no update`);
    return captured.update;
  };

  /** Creates a page's descendants in a scratch doc that holds only that page; recurses into big subtrees. */
  const updates: Uint8Array[] = [];
  const buildChunk = (root: PagePlan, rootUpdate: Uint8Array): void => {
    const doc = seededDoc(seed, `chunk/${root.id}`);
    Y.applyUpdate(doc, rootUpdate);
    const before = Y.encodeStateVector(doc);
    const nested: Array<[PagePlan, Uint8Array]> = [];
    const created: PagePlan[] = [];
    const visit = (parent: PagePlan) => {
      for (const child of children.get(parent.id) ?? []) {
        created.push(child);
        if ((size.get(child.id) ?? 1) > CHUNK_SIZE)
          nested.push([child, createStandalone(doc, child)]);
        else {
          createPlannedPage(doc, child);
          visit(child);
        }
      }
    };
    visit(root);
    for (const page of created) {
      if (page.trashed)
        trashPage(doc, page.id, { now: trashTime(plan, page), userId: authorOf(page) });
    }
    updates.push(Y.encodeStateAsUpdate(doc, before));
    doc.destroy();
    for (const [page, update] of nested) buildChunk(page, update);
  };

  for (const root of children.get(null) ?? []) {
    const update = createStandalone(ws, root);
    if (children.has(root.id)) buildChunk(root, update);
  }
  for (const update of updates) Y.applyUpdate(ws, update);
  for (const root of children.get(null) ?? []) {
    if (root.trashed)
      trashPage(ws, root.id, { now: trashTime(plan, root), userId: authorOf(root) });
  }
  return ws;
}

function trashTime(plan: WorkspacePlan, page: PagePlan): number {
  return Math.min(plan.options.now, page.updatedAt + 86_400_000);
}

/** A page doc (`page:<id>`) holding `content` and the page's tags and aliases. */
export function buildPageDoc(plan: WorkspacePlan, page: PagePlan, content: DocJSON): Y.Doc {
  const doc = seededDoc(plan.options.seed, `page/${page.id}`);
  writeDocJSON(doc, content);
  const props: Record<string, string[]> = {};
  if (page.tags.length) props.tags = page.tags;
  if (page.aliases.length) props.aliases = page.aliases;
  if (Object.keys(props).length) setPageProps(doc, props);
  return doc;
}

/** Creates the schema and views of a database in `db`, then stamps it with `initDatabaseDoc`. */
function writeSchema(db: Y.Doc, database: DatabasePlan): void {
  for (const property of database.properties) {
    addProperty(
      db,
      {
        id: property.id,
        name: property.name,
        type: property.type,
        ...(property.options ? { options: property.options } : {}),
        ...(property.number ? { number: property.number } : {}),
        ...(property.date ? { date: property.date } : {}),
        ...(property.relation ? { relation: property.relation } : {}),
      },
      { now: database.createdAt },
    );
  }
  for (const view of database.views) addView(db, view, { now: database.createdAt });
  // The title property and a view exist, so this only stamps the version and creation time.
  const title = database.properties.find((property) => property.type === 'title');
  initDatabaseDoc(db, {
    titlePropertyName: title?.name ?? 'Name',
    viewName: database.views[0]?.name ?? 'Table',
    now: database.createdAt,
  });
}

/** A database doc (`db:<id>`): schema, views and every row's values. */
export function buildDatabaseDoc(plan: WorkspacePlan, database: DatabasePlan): Y.Doc {
  const seed = plan.options.seed;
  const db = seededDoc(seed, `database/${database.id}`);
  const schema: { update: Uint8Array | null } = { update: null };
  const capture = (update: Uint8Array) => {
    schema.update = schema.update ? Y.mergeUpdates([schema.update, update]) : update;
  };
  db.on('update', capture);
  writeSchema(db, database);
  db.off('update', capture);
  const schemaUpdate = schema.update;
  const author = (index: number) =>
    GENERATED_AUTHORS[index % GENERATED_AUTHORS.length] ?? 'user-ada';
  if (database.rows.length <= ROW_CHUNK || !schemaUpdate) {
    database.rows.forEach((row, index) => {
      addRow(db, { id: row.id, values: row.values }, { now: row.updatedAt, userId: author(index) });
    });
    return db;
  }
  // Large databases: rows in chunks, each in a scratch doc that starts from the schema. Rows of
  // different chunks can share order keys; the order then falls back to row IDs (still stable).
  for (let start = 0; start < database.rows.length; start += ROW_CHUNK) {
    const scratch = seededDoc(seed, `database/${database.id}/rows/${start}`);
    Y.applyUpdate(scratch, schemaUpdate);
    const before = Y.encodeStateVector(scratch);
    database.rows.slice(start, start + ROW_CHUNK).forEach((row, offset) => {
      addRow(
        scratch,
        { id: row.id, values: row.values },
        { now: row.updatedAt, userId: author(start + offset) },
      );
    });
    Y.applyUpdate(db, Y.encodeStateAsUpdate(scratch, before));
    scratch.destroy();
  }
  return db;
}
