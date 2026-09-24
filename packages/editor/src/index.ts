/**
 * @tessera/editor — the block editor (Agent 02): TipTap on Yjs, implementing exactly the canonical
 * document schema from `@tessera/core`.
 *
 * - `@tessera/editor/page-editor`: the `page` body (lazy-loaded by `apps/web/src/features/editor`).
 * - `@tessera/editor/i18n`: the editor's strings (`t`).
 * - This entry: the schema extensions and the editor extension set, for previews and tests.
 */
export const EDITOR_PACKAGE = '@tessera/editor';
export { schemaExtensions, type SchemaExtensionsOptions } from './schema';
export { editorExtensions, type EditorExtensionsOptions } from './editor-extensions';
