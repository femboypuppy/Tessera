import { mergeAttributes, Node } from '@tiptap/core';
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Turns the current textblock into a toggle (its text becomes the summary). */
      setToggle: () => ReturnType;
      /** Opens or closes the toggle at `pos` (not added to the undo history). */
      setToggleOpen: (pos: number, open: boolean) => ReturnType;
    };
  }
}

/** Finds the toggle whose summary holds the selection. */
function summaryContext(node: PMNode, depth: number, $pos: ResolvedPos) {
  if (node.type.name !== 'toggleSummary' || depth < 1) return null;
  const toggle = $pos.node(depth - 1);
  if (toggle.type.name !== 'toggle') return null;
  return { toggle, togglePos: $pos.before(depth - 1) };
}

/** `toggleSummary`: the always-visible first line of a toggle (`inline*`). */
export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'summary' }, { tag: 'div[data-type="toggle-summary"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-summary' }), 0];
  },
});

/**
 * `toggle`: a summary line and the blocks it hides (`toggleSummary block*`). `open` is stored in
 * the document so the toggle remembers its state; opening and closing is not an undoable edit.
 */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary block*',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element) =>
          element.hasAttribute('open') || element.getAttribute('data-open') === 'true',
        renderHTML: (attributes) => (attributes.open ? { 'data-open': 'true' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }, { tag: 'div[data-type="toggle"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'toggle', class: 'tess-toggle' }),
      0,
    ];
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from, $to } = state.selection;
          if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
          const block = $from.parent;
          if (block.type.name === 'codeBlock' || block.type.name === 'toggleSummary') return false;
          const depth = $from.depth;
          const pos = $from.before(depth);
          const summary = state.schema.nodes.toggleSummary?.create(null, block.content);
          const toggle = summary && state.schema.nodes.toggle?.create({ open: true }, summary);
          if (!toggle) return false;
          const parent = $from.node(depth - 1);
          const index = $from.index(depth - 1);
          if (!parent.canReplace(index, index + 1, Fragment.from(toggle))) return false;
          if (dispatch) {
            const offset = $from.parentOffset;
            tr.replaceWith(pos, pos + block.nodeSize, toggle);
            tr.setSelection(TextSelection.create(tr.doc, pos + 2 + offset));
          }
          return true;
        },
      setToggleOpen:
        (pos, open) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== this.name) return false;
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, open });
            tr.setMeta('addToHistory', false);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        const context = summaryContext($from.parent, $from.depth, $from);
        if (!context) return false;
        const { toggle, togglePos } = context;
        const summary = $from.parent;
        const summaryStart = $from.start();
        const after = summary.content.cut($from.parentOffset);
        const { paragraph, toggleSummary } = state.schema.nodes;
        if (!paragraph || !toggleSummary) return false;
        const tr = state.tr;
        // An empty toggle with nothing inside turns back into a paragraph.
        if (summary.content.size === 0 && toggle.childCount === 1) {
          tr.replaceWith(togglePos, togglePos + toggle.nodeSize, paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        tr.delete($from.pos, summaryStart + summary.content.size);
        if (toggle.attrs.open) {
          // Open: the rest of the line becomes the first block inside.
          const insertAt = tr.mapping.map(summaryStart + summary.content.size) + 1;
          tr.insert(insertAt, paragraph.create(null, after));
          tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
        } else {
          // Closed: a new toggle follows, like a new list item.
          const end = tr.mapping.map(togglePos + toggle.nodeSize);
          const next = this.type.create(
            { open: false },
            toggleSummary.create(null, after.size ? after : undefined),
          );
          tr.insert(end, next);
          tr.setSelection(TextSelection.create(tr.doc, end + 2));
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parentOffset !== 0) return false;
        const context = summaryContext($from.parent, $from.depth, $from);
        if (!context) return false;
        const { toggle, togglePos } = context;
        const { paragraph } = state.schema.nodes;
        if (!paragraph) return false;
        // Unwrap: the summary becomes a paragraph and the hidden blocks follow it.
        const blocks: PMNode[] = [paragraph.create(null, $from.parent.content)];
        toggle.forEach((child, _offset, index) => {
          if (index > 0) blocks.push(child);
        });
        const tr = state.tr.replaceWith(togglePos, togglePos + toggle.nodeSize, blocks);
        tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
