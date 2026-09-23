import * as Y from 'yjs';

/**
 * Merges stored updates into one equivalent state update, dropping deleted content (the scratch
 * doc garbage-collects). Pending structs (updates whose dependencies never arrived) are kept by
 * `encodeStateAsUpdate`, so nothing that was stored is lost.
 */
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

/**
 * Merges updates for loading. A corrupt update (disk damage, a bug in an older version) must not
 * make the whole doc unreadable: when the fast merge fails, each update is applied on its own and
 * the ones that fail are skipped and reported.
 */
export function mergeUpdatesSafely(
  updates: readonly Uint8Array[],
  onCorrupt?: (index: number, error: unknown) => void,
): Uint8Array {
  if (updates.length === 1 && updates[0]) return updates[0];
  try {
    return Y.mergeUpdates([...updates]);
  } catch {
    const doc = new Y.Doc();
    try {
      updates.forEach((update, index) => {
        try {
          Y.applyUpdate(doc, update);
        } catch (error) {
          onCorrupt?.(index, error);
        }
      });
      return Y.encodeStateAsUpdate(doc);
    } finally {
      doc.destroy();
    }
  }
}
