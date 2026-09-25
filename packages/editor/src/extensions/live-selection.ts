import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const liveSelectionKey = new PluginKey('tesseraLiveSelection');

/** Whether the DOM caret (or range) is somewhere other than where the editor's state has it. */
function domSelectionMoved(view: EditorView): boolean {
  const selection = view.dom.ownerDocument.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (!selection || !anchorNode || !focusNode) return false;
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return false;
  try {
    const { anchor, head } = view.state.selection;
    return (
      view.posAtDOM(anchorNode, selection.anchorOffset) !== anchor ||
      view.posAtDOM(focusNode, selection.focusOffset) !== head
    );
  } catch {
    // A DOM position ProseMirror doesn't map (a node view's own controls): nothing to catch up on.
    return false;
  }
}

/**
 * Makes every key command act where the caret is. The browser moves the caret itself for End, Home
 * and the arrow keys, and tells the editor with a `selectionchange` event that comes after the key.
 * When the main thread is busy, Chromium handles the next key first (input goes ahead of other
 * tasks), so End then Enter split the line where the caret *was*. Before any key handler runs,
 * this checks the DOM selection and, if it moved, lets ProseMirror read it right away, through the
 * same `selectionchange` handling it would have run a moment later.
 */
export const LiveSelection = Extension.create({
  name: 'liveSelection',
  // Ahead of every keymap (the highest others use is 1100).
  priority: 10_000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: liveSelectionKey,
        props: {
          handleKeyDown(view) {
            if (!view.composing && view.hasFocus() && domSelectionMoved(view))
              view.dom.ownerDocument.dispatchEvent(new Event('selectionchange'));
            return false;
          },
        },
      }),
    ];
  },
});
