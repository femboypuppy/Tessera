import { listProperties, listRows, type AppContext } from '@tessera/core';
import type * as Y from 'yjs';
import { relationIds } from './relations';

/** A one-way relation pointing at a page: which database, property and row. */
export interface BackReference {
  databaseId: string;
  propertyId: string;
  propertyName: string;
  rowId: string;
}

type Ctx = Pick<AppContext, 'workspace' | 'loadDatabaseDoc'>;

/**
 * Which rows point at each page through one-way relations (two-way relations already show on
 * the target as their back property). Built lazily the first time a page asks, by reading each
 * database once, then kept current from `database.changed`; views never load row pages for it.
 */
export class BackReferenceIndex {
  private readonly byDatabase = new Map<string, BackReference[]>();
  private readonly byTarget = new Map<string, BackReference[]>();
  private building: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly ctx: Ctx) {}

  /** Reads every database once (later calls reuse the result). */
  ensureBuilt(): Promise<void> {
    this.building ??= (async () => {
      const databases = this.ctx.workspace.pages
        .getSnapshot()
        .all()
        .filter((page) => page.kind === 'database');
      for (const database of databases) await this.refresh(database.id);
    })();
    return this.building;
  }

  /** Re-reads one database (after it changed). */
  async refresh(databaseId: string): Promise<void> {
    const handle = await this.ctx.loadDatabaseDoc(databaseId);
    try {
      this.setDatabase(databaseId, collect(databaseId, handle.doc));
    } finally {
      handle.release();
    }
  }

  /** Drops a deleted database. */
  remove(databaseId: string): void {
    if (this.byDatabase.has(databaseId)) this.setDatabase(databaseId, []);
  }

  /** Whether the index was built (updates only matter then). */
  get built(): boolean {
    return this.building !== null;
  }

  refsTo(pageId: string): readonly BackReference[] {
    return this.byTarget.get(pageId) ?? [];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private setDatabase(databaseId: string, refs: Array<BackReference & { targetId: string }>): void {
    const previous = this.byDatabase.get(databaseId) ?? [];
    if (previous.length === 0 && refs.length === 0) return;
    for (const [target, list] of this.byTarget) {
      const kept = list.filter((ref) => ref.databaseId !== databaseId);
      if (kept.length === 0) this.byTarget.delete(target);
      else if (kept.length !== list.length) this.byTarget.set(target, kept);
    }
    for (const { targetId, ...ref } of refs) {
      const list = this.byTarget.get(targetId) ?? [];
      list.push(ref);
      this.byTarget.set(targetId, list);
    }
    this.byDatabase.set(databaseId, refs);
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

function collect(databaseId: string, doc: Y.Doc): Array<BackReference & { targetId: string }> {
  const properties = listProperties(doc).filter(
    (property) => property.type === 'relation' && !property.relation?.backPropertyId,
  );
  if (properties.length === 0) return [];
  const refs: Array<BackReference & { targetId: string }> = [];
  for (const row of listRows(doc)) {
    for (const property of properties) {
      for (const targetId of relationIds(row.values[property.id])) {
        refs.push({
          databaseId,
          propertyId: property.id,
          propertyName: property.name,
          rowId: row.id,
          targetId,
        });
      }
    }
  }
  return refs;
}

const indexes = new WeakMap<Y.Doc, BackReferenceIndex>();

/** The index of a workspace session (one per workspace doc). */
export function backReferenceIndexFor(ctx: Ctx): BackReferenceIndex {
  let index = indexes.get(ctx.workspace.doc);
  if (!index) {
    index = new BackReferenceIndex(ctx);
    indexes.set(ctx.workspace.doc, index);
  }
  return index;
}

/** The index if a page already asked for it (so events do not build it). */
export function existingBackReferenceIndex(
  ctx: Pick<AppContext, 'workspace'>,
): BackReferenceIndex | undefined {
  return indexes.get(ctx.workspace.doc);
}
