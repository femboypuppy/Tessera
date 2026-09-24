import { newBlockId } from '@tessera/core';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { BLOCK_ID_TYPES } from '../schema/attributes';
import { changedRanges } from './changed-ranges';

const BLOCK_ID_TYPE_SET = new Set<string>(BLOCK_ID_TYPES);

/** Meta that makes the block-ID plugin skip a transaction. */
export const SKIP_BLOCK_IDS = 'tessera:skipBlockIds';

export const blockIdsPluginKey = new PluginKey('tesseraBlockIds');

function isRemote(tr: Transaction): boolean {
  return !!tr.getMeta(ySyncPluginKey);
}

/** Every block ID in the document, with the position of each occurrence. */
function collectBlockIds(doc: PMNode): Map<string, number[]> {
  const ids = new Map<string, number[]>();
  doc.descendants((node, pos) => {
    const id = node.attrs.blockId;
    if (typeof id === 'string') {
      const list = ids.get(id);
      if (list) list.push(pos);
      else ids.set(id, [pos]);
    }
    return !node.isTextblock;
  });
  return ids;
}

/**
 * Keeps block IDs present and unique, for local edits only (remote changes and the initial load
 * are never rewritten):
 * - blocks created or touched by the edit get an ID when they have none (splitting a block gives
 *   the new half a fresh one, because `blockId` isn't kept on split);
 * - a block inserted with an ID that already exists elsewhere (copy and paste, duplicate) gets a
 *   new one, while a moved block keeps its own.
 */
export const BlockIds = Extension.create({
  name: 'blockIds',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdsPluginKey,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => isRemote(tr) || tr.getMeta(SKIP_BLOCK_IDS))) return null;
          const ranges = changedRanges(transactions);
          if (ranges.length === 0) return null;
          const { doc } = newState;
          const missing: number[] = [];
          const inserted: Array<{ pos: number; id: string }> = [];
          const visited = new Set<number>();
          for (const { from, to } of ranges) {
            const start = Math.max(0, Math.min(from, doc.content.size));
            const end = Math.max(start, Math.min(to, doc.content.size));
            doc.nodesBetween(start, end, (node, pos) => {
              if (visited.has(pos)) return !node.isTextblock;
              visited.add(pos);
              if (BLOCK_ID_TYPE_SET.has(node.type.name)) {
                const id = node.attrs.blockId;
                if (typeof id !== 'string') missing.push(pos);
                else if (pos >= start) inserted.push({ pos, id });
              }
              return !node.isTextblock;
            });
          }
          if (missing.length === 0 && inserted.length === 0) return null;
          let all: Map<string, number[]> | null = null;
          const used = (): Map<string, number[]> => {
            all ??= collectBlockIds(doc);
            return all;
          };
          const reassign = new Set<number>(missing);
          for (const { pos, id } of inserted) {
            const positions = used().get(id) ?? [];
            if (positions.length < 2) continue;
            // Keep the occurrence outside the edit (the original); renumber the inserted ones.
            const original =
              positions.find((candidate) => !inserted.some((item) => item.pos === candidate)) ??
              positions[0];
            if (pos !== original) reassign.add(pos);
          }
          if (reassign.size === 0) return null;
          // Random 8-character IDs practically never collide; check against the document only when
          // it was scanned anyway, so pressing Enter on a long page stays cheap.
          const existing = new Set<string>(all ? [...(all as Map<string, number[]>).keys()] : []);
          const tr = newState.tr;
          for (const pos of [...reassign].sort((a, b) => a - b)) {
            const node = tr.doc.nodeAt(pos);
            if (!node || !BLOCK_ID_TYPE_SET.has(node.type.name)) continue;
            const id = newBlockId(existing);
            existing.add(id);
            tr.setNodeAttribute(pos, 'blockId', id);
          }
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
