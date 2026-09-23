/** The three kinds of Y.Doc in a workspace. */
export type DocKind = 'workspace' | 'page' | 'database';

/** Doc name prefixes. A doc name is always `<prefix><id>`. */
export const DOC_NAME_PREFIX = {
  workspace: 'ws:',
  page: 'page:',
  database: 'db:',
} as const satisfies Record<DocKind, string>;

/**
 * Name of the workspace doc (`ws:<workspaceId>`), which holds the page tree and settings.
 *
 * @example
 * workspaceDocName('abc'); // 'ws:abc'
 */
export function workspaceDocName(workspaceId: string): string {
  return `${DOC_NAME_PREFIX.workspace}${workspaceId}`;
}

/** Name of a page doc (`page:<pageId>`), which holds the page content and page props. */
export function pageDocName(pageId: string): string {
  return `${DOC_NAME_PREFIX.page}${pageId}`;
}

/**
 * Name of a database doc (`db:<databaseId>`), which holds schema, views and row values.
 * The database ID is the ID of the database's page (the `PageMeta` with `kind: 'database'`).
 */
export function databaseDocName(databaseId: string): string {
  return `${DOC_NAME_PREFIX.database}${databaseId}`;
}

/** A parsed doc name. */
export interface ParsedDocName {
  kind: DocKind;
  id: string;
}

/**
 * Parses a doc name into its kind and ID, or returns null when the name is not a Tessera doc name.
 *
 * @example
 * parseDocName('page:abc'); // { kind: 'page', id: 'abc' }
 */
export function parseDocName(docName: string): ParsedDocName | null {
  for (const kind of ['workspace', 'page', 'database'] as const) {
    const prefix = DOC_NAME_PREFIX[kind];
    if (docName.startsWith(prefix) && docName.length > prefix.length) {
      return { kind, id: docName.slice(prefix.length) };
    }
  }
  return null;
}
