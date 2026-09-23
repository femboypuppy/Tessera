import * as Y from 'yjs';
import type { Db } from '../db/database';

/** Merges updates into one state update, dropping deleted content (the scratch doc GCs). */
export function compactUpdates(updates: readonly Uint8Array[]): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      for (const update of updates) Y.applyUpdate(doc, update);
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

function toBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export interface DocPersistenceOptions {
  /** Compact a doc once it has this many stored updates. Default 200. */
  compactAfter?: number;
  now?: () => number;
  onError?: (error: unknown, context: { workspaceId: string; docName: string }) => void;
}

/**
 * The server's document storage: an append-only log of Yjs updates per doc in SQLite.
 *
 * better-sqlite3 is synchronous and every write runs on the one JavaScript thread, so a
 * compaction transaction (read every row, merge, delete them, insert the result) can never
 * interleave with an incoming update: the update lands entirely before or after it.
 */
export class DocPersistence {
  private readonly counts = new Map<string, number>();
  private readonly scheduled = new Set<string>();
  /** Docs deleted by this process (checked on every append). */
  private readonly deleted = new Set<string>();
  private readonly compactAfter: number;
  private readonly now: () => number;
  private readonly statements;

  constructor(
    private readonly db: Db,
    private readonly options: DocPersistenceOptions = {},
  ) {
    this.compactAfter = options.compactAfter ?? 200;
    this.now = options.now ?? Date.now;
    this.statements = {
      select: db.prepare(
        'SELECT id, data FROM doc_updates WHERE workspace_id = ? AND doc_name = ? ORDER BY id',
      ),
      insert: db.prepare(
        'INSERT INTO doc_updates (workspace_id, doc_name, data, created_at) VALUES (?, ?, ?, ?)',
      ),
      upsertDoc: db.prepare(
        `INSERT INTO docs (workspace_id, name, seq, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, name) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at`,
      ),
      deleteUpTo: db.prepare(
        'DELETE FROM doc_updates WHERE workspace_id = ? AND doc_name = ? AND id <= ?',
      ),
      count: db.prepare(
        'SELECT COUNT(*) AS n FROM doc_updates WHERE workspace_id = ? AND doc_name = ?',
      ),
      busy: db.prepare(
        `SELECT workspace_id AS workspaceId, doc_name AS docName, COUNT(*) AS n FROM doc_updates
         GROUP BY workspace_id, doc_name HAVING n >= ?`,
      ),
      listDocs: db.prepare(
        'SELECT name, seq, updated_at AS updatedAt FROM docs WHERE workspace_id = ? ORDER BY name',
      ),
      isDeleted: db.prepare('SELECT 1 FROM deleted_docs WHERE workspace_id = ? AND name = ?'),
    };
  }

  /** Every stored update of a doc merged into one, or null for a doc never stored. */
  load(workspaceId: string, docName: string): Uint8Array | null {
    const rows = this.statements.select.all(workspaceId, docName) as Array<{
      id: number;
      data: Buffer;
    }>;
    this.counts.set(this.key(workspaceId, docName), rows.length);
    if (rows.length === 0) return null;
    const updates = rows.map((row) => toBytes(row.data));
    if (updates.length === 1 && updates[0]) return updates[0];
    try {
      return Y.mergeUpdates(updates);
    } catch (error) {
      // One damaged row must not make the whole doc unreadable: apply them one by one.
      this.options.onError?.(error, { workspaceId, docName });
      const doc = new Y.Doc();
      try {
        for (const update of updates) {
          try {
            Y.applyUpdate(doc, update);
          } catch (inner) {
            this.options.onError?.(inner, { workspaceId, docName });
          }
        }
        return Y.encodeStateAsUpdate(doc);
      } finally {
        doc.destroy();
      }
    }
  }

  /**
   * Stores one update durably (synchronously). Returns the doc's new sequence number, or 0 for a
   * doc deleted meanwhile (a straggling update must not bring it back).
   */
  append(workspaceId: string, docName: string, update: Uint8Array): number {
    if (this.deleted.has(this.key(workspaceId, docName))) return 0;
    const now = this.now();
    const seq = this.db.transaction(() => {
      const info = this.statements.insert.run(workspaceId, docName, Buffer.from(update), now);
      const id = Number(info.lastInsertRowid);
      this.statements.upsertDoc.run(workspaceId, docName, id, now);
      return id;
    })();
    const key = this.key(workspaceId, docName);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count >= this.compactAfter) this.scheduleCompaction(workspaceId, docName);
    return seq;
  }

  /** Replaces a doc's updates with one equivalent update. Returns the row counts. */
  compact(workspaceId: string, docName: string): { before: number; after: number } {
    const result = this.db.transaction(() => {
      const rows = this.statements.select.all(workspaceId, docName) as Array<{
        id: number;
        data: Buffer;
      }>;
      if (rows.length < 2) return { before: rows.length, after: rows.length };
      const merged = compactUpdates(rows.map((row) => toBytes(row.data)));
      const last = rows[rows.length - 1];
      if (!last) return { before: rows.length, after: rows.length };
      this.statements.deleteUpTo.run(workspaceId, docName, last.id);
      // The doc's `seq` stays: compaction changes the storage, not the content.
      this.statements.insert.run(workspaceId, docName, Buffer.from(merged), this.now());
      return { before: rows.length, after: 1 };
    })();
    this.counts.set(this.key(workspaceId, docName), result.after);
    return result;
  }

  /** Compacts every doc with at least `minUpdates` stored updates (periodic maintenance). */
  compactBusyDocs(minUpdates = 20): number {
    const busy = this.statements.busy.all(minUpdates) as Array<{
      workspaceId: string;
      docName: string;
    }>;
    let compacted = 0;
    for (const { workspaceId, docName } of busy) {
      try {
        this.compact(workspaceId, docName);
        compacted += 1;
      } catch (error) {
        this.options.onError?.(error, { workspaceId, docName });
      }
    }
    return compacted;
  }

  /** Number of stored rows of a doc (tests, diagnostics). */
  updateCount(workspaceId: string, docName: string): number {
    const row = this.statements.count.get(workspaceId, docName) as { n: number };
    return row.n;
  }

  /** Docs of a workspace with their sequence numbers (clients compare them to fetch changes). */
  listDocs(workspaceId: string): Array<{ name: string; seq: number; updatedAt: number }> {
    return this.statements.listDocs.all(workspaceId) as Array<{
      name: string;
      seq: number;
      updatedAt: number;
    }>;
  }

  /** Deletes a doc, its history, and remembers it was deleted (so it can't be recreated). */
  deleteDoc(workspaceId: string, docName: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM doc_updates WHERE workspace_id = ? AND doc_name = ?')
        .run(workspaceId, docName);
      this.db
        .prepare('DELETE FROM versions WHERE workspace_id = ? AND doc_name = ?')
        .run(workspaceId, docName);
      this.db
        .prepare('DELETE FROM docs WHERE workspace_id = ? AND name = ?')
        .run(workspaceId, docName);
      this.db
        .prepare(
          'INSERT INTO deleted_docs (workspace_id, name, deleted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .run(workspaceId, docName, this.now());
    })();
    this.counts.delete(this.key(workspaceId, docName));
    this.deleted.add(this.key(workspaceId, docName));
  }

  isDeleted(workspaceId: string, docName: string): boolean {
    return this.statements.isDeleted.get(workspaceId, docName) !== undefined;
  }

  private scheduleCompaction(workspaceId: string, docName: string): void {
    const key = this.key(workspaceId, docName);
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    // Not inside the write: the client's acknowledgement goes out first.
    setImmediate(() => {
      this.scheduled.delete(key);
      try {
        this.compact(workspaceId, docName);
      } catch (error) {
        this.options.onError?.(error, { workspaceId, docName });
      }
    });
  }

  private key(workspaceId: string, docName: string): string {
    return `${workspaceId}\u0000${docName}`;
  }
}
