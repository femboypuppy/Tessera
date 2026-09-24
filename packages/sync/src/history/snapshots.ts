import {
  docJSONEqual,
  getPageProps,
  PAGE_DOC_KEYS,
  readDocJSON,
  setPageProps,
  writeDocJSON,
  type DocJSON,
  type JsonValue,
} from '@tessera/core';
import * as Y from 'yjs';

/** What a version holds, read back from its Yjs state. */
export interface VersionContent {
  doc: DocJSON;
  props: Record<string, JsonValue>;
}

/** The content (document and page props) of a page doc state. */
export function contentOf(state: Uint8Array): VersionContent {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return { doc: readDocJSON(doc), props: getPageProps(doc) as Record<string, JsonValue> };
  } finally {
    doc.destroy();
  }
}

/** The content of a live page doc. */
export function currentContent(doc: Y.Doc): VersionContent {
  return { doc: readDocJSON(doc), props: getPageProps(doc) as Record<string, JsonValue> };
}

export function sameContent(a: VersionContent, b: VersionContent): boolean {
  return (
    docJSONEqual(a.doc, b.doc) &&
    JSON.stringify(sortKeys(a.props)) === JSON.stringify(sortKeys(b.props))
  );
}

function sortKeys(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/** Transaction origin of restores (the undo manager tracks only these). */
export const RESTORE_ORIGIN = Symbol('tessera:restore-version');

/**
 * Writes a version's content into the live page doc **as a new edit** (the CRDT history is not
 * rewound): the document is replaced with a minimal diff, and props not in the version are
 * removed. Returns an undo that reverts exactly this edit, also after others edited elsewhere.
 */
export function restoreInto(
  doc: Y.Doc,
  content: VersionContent,
): { undo(): boolean; dispose(): void } {
  const undoManager = new Y.UndoManager(
    [doc.getXmlFragment(PAGE_DOC_KEYS.content), doc.getMap(PAGE_DOC_KEYS.props)],
    { trackedOrigins: new Set([RESTORE_ORIGIN]), captureTimeout: 0 },
  );
  doc.transact(() => {
    writeDocJSON(doc, content.doc, { origin: RESTORE_ORIGIN });
    const next: Record<string, JsonValue | undefined> = { ...content.props };
    for (const key of Object.keys(getPageProps(doc))) if (!(key in next)) next[key] = undefined;
    setPageProps(doc, next);
  }, RESTORE_ORIGIN);
  return {
    undo: () => {
      if (undoManager.undoStack.length === 0) return false;
      undoManager.undo();
      return true;
    },
    dispose: () => undoManager.destroy(),
  };
}
