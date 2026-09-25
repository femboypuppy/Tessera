import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';

export const remoteEditCaretKey = new PluginKey('tesseraRemoteEditCaret');

/** The part of y-tiptap's binding this extension touches (its caret saved before a change). */
interface BindingLike {
  beforeTransactionSelection: { absAnchor?: number | null; absHead?: number | null } | null;
}

/**
 * Whether a Yjs transaction added, removed or moved blocks (a child list other than text
 * changed), as opposed to editing text, marks or attributes inside existing blocks.
 */
export function changesStructure(transaction: Y.Transaction): boolean {
  for (const [type, keys] of transaction.changed) {
    if (!(type instanceof Y.XmlText) && keys.has(null)) return true;
  }
  return false;
}

/**
 * Keeps the caret where Yjs puts it when someone else edits the same block.
 *
 * After a remote change, `@tiptap/y-tiptap` 3.0.9 restores the caret from its Yjs relative
 * position (anchored to the character before it), then second-guesses it: if the text of the
 * caret's block changed, it takes the position as "misresolved" (a check meant for moved blocks)
 * and puts the caret back at its old offset in the block. So when a collaborator typed in the
 * same block before the caret, the caret no longer followed the text, and the next keystrokes
 * landed inside their words: two people typing at the same spot scrambled each other's text.
 *
 * For remote changes that leave the blocks where they are, this drops the absolute positions
 * that check needs, so the Yjs position wins. Changes that add, remove or move blocks keep
 * y-tiptap's recovery. Undo and redo are {@link HistoryGuard}'s.
 */
export const RemoteEditCaret = Extension.create<{ fragment: Y.XmlFragment | null }>({
  name: 'remoteEditCaret',

  addOptions() {
    return { fragment: null };
  },

  addProseMirrorPlugins() {
    const doc = this.options.fragment?.doc;
    if (!doc) return [];
    return [
      new Plugin({
        key: remoteEditCaretKey,
        view: (view) => {
          // After the change is in the doc and before observers run: y-tiptap restores the caret
          // in its observer, from the selection it saved when the transaction began.
          const onBeforeObserverCalls = (transaction: Y.Transaction) => {
            if (transaction.local || changesStructure(transaction)) return;
            const binding = (
              ySyncPluginKey.getState(view.state) as { binding?: BindingLike } | undefined
            )?.binding;
            const selection = binding?.beforeTransactionSelection;
            if (!binding || !selection) return;
            if (selection.absAnchor == null && selection.absHead == null) return;
            binding.beforeTransactionSelection = { ...selection, absAnchor: null, absHead: null };
          };
          doc.on('beforeObserverCalls', onBeforeObserverCalls);
          return { destroy: () => doc.off('beforeObserverCalls', onBeforeObserverCalls) };
        },
      }),
    ];
  },
});
