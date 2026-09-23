import type { DocKind } from '@tessera/core';

/**
 * Documents on the server are named `<workspaceId>/<docName>` (`abc/page:xyz`), so every doc is
 * scoped to its workspace: membership of the workspace in the name is what authorizes access,
 * and the same page ID in two workspaces can never collide. The client builds the same names
 * (`packages/sync/src/provider/doc-names.ts`).
 */
export interface ServerDocName {
  workspaceId: string;
  /** The client-side doc name (`ws:<id>`, `page:<id>`, `db:<id>`). */
  docName: string;
  kind: DocKind;
  id: string;
}

const PATTERN = /^([A-Za-z0-9_-]{1,64})\/(ws|page|db):([A-Za-z0-9_-]{1,64})$/;

const KINDS: Record<string, DocKind> = { ws: 'workspace', page: 'page', db: 'database' };

/** Parses a server doc name, or null when it is malformed (or a workspace doc of another ID). */
export function parseServerDocName(name: string): ServerDocName | null {
  const match = PATTERN.exec(name);
  if (!match) return null;
  const [, workspaceId, prefix, id] = match;
  if (!workspaceId || !prefix || !id) return null;
  const kind = KINDS[prefix];
  if (!kind) return null;
  if (kind === 'workspace' && id !== workspaceId) return null;
  return { workspaceId, docName: `${prefix}:${id}`, kind, id };
}

/** Whether a client doc name is valid (`ws:…`, `page:…`, `db:…`). */
export function isClientDocName(docName: string): boolean {
  return /^(ws|page|db):[A-Za-z0-9_-]{1,64}$/.test(docName);
}

export function serverDocName(workspaceId: string, docName: string): string {
  return `${workspaceId}/${docName}`;
}
