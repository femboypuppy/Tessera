import { prosemirrorToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { ValidationError } from '../errors';
import { PAGE_DOC_KEYS } from '../model/page-doc';
import { docJSONEqual, normalizeDocJSON, validateDocJSON } from './docjson';
import type { DocJSON } from './types';

/** Options for the Y.Doc ↔ DocJSON bridge. */
export interface DocJSONOptions {
  /** Name of the `Y.XmlFragment` (default `content`, the page doc's content). */
  field?: string;
  /** Transaction origin for writes. */
  origin?: unknown;
}

/**
 * Reads a page doc's content as normalized {@link DocJSON}. Never throws and never modifies the
 * doc (unlike rendering through y-prosemirror, which deletes nodes it cannot parse).
 *
 * @example
 * const handle = await ctx.loadPageDoc(pageId);
 * const text = extractPlainText(readDocJSON(handle.doc));
 */
export function readDocJSON(ydoc: Y.Doc, options: DocJSONOptions = {}): DocJSON {
  const fragment = ydoc.getXmlFragment(options.field ?? PAGE_DOC_KEYS.content);
  return normalizeDocJSON(yXmlFragmentToProsemirrorJSON(fragment));
}

/**
 * Replaces a page doc's content with `json`, as a minimal diff (unchanged blocks are kept, so
 * concurrent edits elsewhere survive and remote cursors stay put). Throws {@link ValidationError}
 * for invalid documents before touching the doc; run untrusted input through `normalizeDocJSON`
 * first.
 *
 * @example
 * writeDocJSON(handle.doc, codec.parse(markdown).doc, { origin: 'import' });
 */
export function writeDocJSON(ydoc: Y.Doc, json: DocJSON, options: DocJSONOptions = {}): void {
  const result = validateDocJSON(json);
  if (!result.ok) throw new ValidationError('Invalid document', result.errors);
  ydoc.transact(() => {
    // Created inside the transaction: creating a root type runs its own (empty) transaction otherwise.
    const fragment = ydoc.getXmlFragment(options.field ?? PAGE_DOC_KEYS.content);
    prosemirrorToYXmlFragment(result.node, fragment);
  }, options.origin ?? null);
}

/**
 * Reads, transforms and writes a doc's content in one transaction. Return the new document, or
 * null/undefined to leave it unchanged. Returns true when something changed.
 *
 * @example
 * updateDocJSON(handle.doc, (doc) => replaceTextWithPageLink(doc, mention, { pageId }));
 */
export function updateDocJSON(
  ydoc: Y.Doc,
  transform: (current: DocJSON) => DocJSON | null | undefined,
  options: DocJSONOptions = {},
): boolean {
  let changed = false;
  ydoc.transact(() => {
    const current = readDocJSON(ydoc, options);
    const next = transform(structuredClone(current));
    if (!next || docJSONEqual(current, next)) return;
    writeDocJSON(ydoc, next, options);
    changed = true;
  }, options.origin ?? null);
  return changed;
}

/**
 * Creates a standalone Y.Doc whose content is `json` (for tests, imports and previews).
 *
 * @example
 * const doc = createDocFromJSON(build.doc(build.p('Hello')));
 */
export function createDocFromJSON(
  json: DocJSON,
  options: Pick<DocJSONOptions, 'field'> = {},
): Y.Doc {
  const doc = new Y.Doc();
  writeDocJSON(doc, json, options);
  return doc;
}
