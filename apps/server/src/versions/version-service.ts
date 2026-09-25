import * as Y from 'yjs';
import type { Db } from '../db/database';
import { conflict, invalid } from '../errors';

export type VersionKind = 'auto' | 'manual' | 'restore';

export interface VersionMeta {
  id: string;
  docName: string;
  createdAt: number;
  createdBy: string | null;
  authorName: string | null;
  label: string | null;
  kind: VersionKind;
  size: number;
}

interface VersionRow {
  id: string;
  workspace_id: string;
  doc_name: string;
  created_at: number;
  created_by: string | null;
  author_name: string | null;
  label: string | null;
  kind: VersionKind;
  size: number;
}

const toMeta = (row: VersionRow): VersionMeta => ({
  id: row.id,
  docName: row.doc_name,
  createdAt: row.created_at,
  createdBy: row.created_by,
  authorName: row.author_name,
  label: row.label,
  kind: row.kind,
  size: row.size,
});

/** Automatic versions kept per doc (manual ones are always kept). */
export const MAX_AUTO_VERSIONS = 100;

/** Version snapshots of page docs, uploaded by clients (restores happen on the client). */
export class VersionService {
  constructor(private readonly db: Db) {}

  list(workspaceId: string, docName: string): VersionMeta[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, doc_name, created_at, created_by, author_name, label, kind, size
         FROM versions WHERE workspace_id = ? AND doc_name = ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(workspaceId, docName) as VersionRow[];
    return rows.map(toMeta);
  }

  get(workspaceId: string, id: string): { meta: VersionMeta; state: Uint8Array } | null {
    const row = this.db
      .prepare('SELECT * FROM versions WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, id) as (VersionRow & { state: Buffer }) | undefined;
    if (!row) return null;
    return {
      meta: toMeta(row),
      state: new Uint8Array(row.state.buffer, row.state.byteOffset, row.state.byteLength),
    };
  }

  /** Stores a version. Idempotent: uploading the same ID twice keeps the first. */
  create(
    workspaceId: string,
    input: Omit<VersionMeta, 'size'> & { state: Uint8Array },
  ): { meta: VersionMeta; created: boolean } {
    // Reject anything that isn't a Yjs update before it reaches other clients.
    const probe = new Y.Doc();
    try {
      Y.applyUpdate(probe, input.state);
    } catch {
      throw invalid('The version is not a valid document state.');
    } finally {
      probe.destroy();
    }
    const existing = this.db
      .prepare('SELECT workspace_id FROM versions WHERE id = ?')
      .get(input.id) as { workspace_id: string } | undefined;
    if (existing) {
      if (existing.workspace_id !== workspaceId) throw conflict('Version ID already used.');
      const row = this.db
        .prepare('SELECT * FROM versions WHERE id = ?')
        .get(input.id) as VersionRow;
      return { meta: toMeta(row), created: false };
    }
    const meta: VersionMeta = {
      id: input.id,
      docName: input.docName,
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      authorName: input.authorName,
      label: input.label,
      kind: input.kind,
      size: input.state.byteLength,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO versions (id, workspace_id, doc_name, created_at, created_by, author_name, label, kind, state, size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          meta.id,
          workspaceId,
          meta.docName,
          meta.createdAt,
          meta.createdBy,
          meta.authorName,
          meta.label,
          meta.kind,
          Buffer.from(input.state),
          meta.size,
        );
      this.db
        .prepare(
          `DELETE FROM versions WHERE id IN (
             SELECT id FROM versions WHERE workspace_id = ? AND doc_name = ? AND kind = 'auto'
             ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
        )
        .run(workspaceId, meta.docName, MAX_AUTO_VERSIONS);
    })();
    return { meta, created: true };
  }
}
