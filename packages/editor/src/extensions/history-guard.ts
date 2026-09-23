import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';

export const historyGuardKey = new PluginKey('tesseraHistoryGuard');
export const historyKeysKey = new PluginKey('tesseraHistoryKeys');

/**
 * Undo and redo keys, ahead of every other keymap: Mod+Z undoes, Mod+Y and Mod+Shift+Z redo, and
 * they are always handled. An empty history must never fall through to the browser's own
 * contenteditable undo (which edits the DOM behind ProseMirror's back), and a redo with nothing
 * to redo must never fall back to the unshifted Mod+Z binding (undo). The Edit menu's
 * undo and redo (`historyUndo` / `historyRedo` input events) go through Yjs too.
 */
export const HistoryKeys = Extension.create({
  name: 'historyKeys',
  priority: 1100,

  addKeyboardShortcuts() {
    const run = (action: 'undo' | 'redo') => () => {
      if (action === 'undo') this.editor.commands.undo();
      else this.editor.commands.redo();
      return true;
    };
    return {
      'Mod-z': run('undo'),
      'Mod-y': run('redo'),
      'Shift-Mod-z': run('redo'),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: historyKeysKey,
        props: {
          handleDOMEvents: {
            beforeinput: (_view, event) => {
              const input = event as InputEvent;
              if (input.inputType !== 'historyUndo' && input.inputType !== 'historyRedo')
                return false;
              event.preventDefault();
              if (input.inputType === 'historyUndo') this.editor.commands.undo();
              else this.editor.commands.redo();
              return true;
            },
          },
        },
      }),
    ];
  },
});

interface RelativeSelectionLike {
  absAnchor?: number | null;
  absHead?: number | null;
  [key: string]: unknown;
}

interface BindingLike {
  beforeTransactionSelection: RelativeSelectionLike | null;
}

interface UndoManagerLike {
  on(event: 'stack-item-popped', listener: () => void): void;
  off(event: 'stack-item-popped', listener: () => void): void;
}

/**
 * Keeps undo and redo reliable on top of `@tiptap/y-tiptap` 3.0.9: after an undo or redo step,
 * y-tiptap keeps that step's saved selection for the *next* Yjs transaction, including absolute
 * positions from an older document. Resolving those against the current document can throw
 * (RangeError), which drops the update and leaves ProseMirror out of sync with Yjs (a redo that
 * never appears). The absolute positions are removed here; the relative positions, which always
 * resolve safely, still restore the caret.
 */
export const HistoryGuard = Extension.create({
  name: 'historyGuard',
  // After Collaboration (priority 1000), so this listener runs after y-tiptap's own.
  priority: 90,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: historyGuardKey,
        view: (view) => {
          const undoManager = (
            yUndoPluginKey.getState(view.state) as { undoManager?: UndoManagerLike } | undefined
          )?.undoManager;
          if (!undoManager) return {};
          const sanitize = () => {
            const binding = (
              ySyncPluginKey.getState(view.state) as { binding?: BindingLike } | undefined
            )?.binding;
            const selection = binding?.beforeTransactionSelection;
            if (
              binding &&
              selection &&
              (selection.absAnchor != null || selection.absHead != null)
            ) {
              binding.beforeTransactionSelection = { ...selection, absAnchor: null, absHead: null };
            }
          };
          undoManager.on('stack-item-popped', sanitize);
          return { destroy: () => undoManager.off('stack-item-popped', sanitize) };
        },
      }),
    ];
  },
});
