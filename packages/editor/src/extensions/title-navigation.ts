import { Extension } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';

export interface TitleNavigationOptions {
  /** Moves focus to the page title (from `PageBodyProps.focusTitle`). */
  focusTitle: ((position: 'start' | 'end') => void) | null;
}

/** True when the selection is a caret in the document's first textblock. */
function inFirstTextblock(selection: Selection): boolean {
  if (!selection.empty || !(selection instanceof TextSelection)) return false;
  const first = Selection.atStart(selection.$from.doc);
  return first instanceof TextSelection && first.$from.start() === selection.$from.start();
}

/**
 * Title ↔ body keyboard navigation: ArrowUp on the first line of the first block, and ArrowLeft or
 * Backspace at its very start (when empty), move the caret to the end of the page title.
 */
export const TitleNavigation = Extension.create<TitleNavigationOptions>({
  name: 'titleNavigation',

  addOptions() {
    return { focusTitle: null };
  },

  addKeyboardShortcuts() {
    const toTitle = () => {
      if (!this.options.focusTitle) return false;
      this.options.focusTitle('end');
      return true;
    };
    return {
      ArrowUp: ({ editor }) => {
        const { selection } = editor.state;
        if (!inFirstTextblock(selection)) return false;
        if (!editor.view.endOfTextblock('up')) return false;
        return toTitle();
      },
      ArrowLeft: ({ editor }) => {
        const { selection } = editor.state;
        if (!inFirstTextblock(selection) || selection.$from.parentOffset !== 0) return false;
        return toTitle();
      },
      Backspace: ({ editor }) => {
        const { selection, doc } = editor.state;
        if (!inFirstTextblock(selection) || selection.$from.parentOffset !== 0) return false;
        const block = selection.$from.parent;
        // Only an empty lone paragraph hands focus back; otherwise Backspace edits as usual.
        if (block.type.name !== 'paragraph' || block.content.size > 0 || doc.childCount > 1)
          return false;
        return toTitle();
      },
    };
  },
});
