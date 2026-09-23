/**
 * Server-side doc names are `<workspaceId>/<docName>` (see `apps/server/src/sync/doc-names.ts`):
 * the workspace in the name is what the server authorizes.
 */
export function serverDocName(workspaceId: string, docName: string): string {
  return `${workspaceId}/${docName}`;
}
