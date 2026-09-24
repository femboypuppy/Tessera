import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  blockAt,
  currentBlock,
  deleteBlocks,
  duplicateBlock,
  moveBlock,
  type BlockRef,
} from '../actions/blocks';
import type { EditorController } from '../react/controller';
import { ownUndoStep } from './history-guard';

/**
 * A selection of consecutive sibling blocks (Shift+↑/↓ from a selected block). It covers whole
 * blocks, so Delete removes them, copying copies them and typing replaces them.
 */
export class BlockRangeSelection extends Selection {
  constructor($from: ResolvedPos, $to: ResolvedPos) {
    super($from, $to);
  }

  override map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    if (from >= to) return Selection.near(doc.resolve(Math.min(from, doc.content.size)));
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if (!$from.sameParent($to)) return TextSelection.between($from, $to);
    return new BlockRangeSelection($from, $to);
  }

  override content(): Slice {
    return new Slice(
      this.$from.parent.content.cut(this.$from.parentOffset, this.$to.parentOffset),
      0,
      0,
    );
  }

  override eq(other: Selection): boolean {
    return other instanceof BlockRangeSelection && other.from === this.from && other.to === this.to;
  }

  override toJSON(): { type: string; from: number; to: number } {
    return { type: 'tesseraBlockRange', from: this.from, to: this.to };
  }

  static override fromJSON(doc: PMNode, json: { from: number; to: number }): BlockRangeSelection {
    return new BlockRangeSelection(doc.resolve(json.from), doc.resolve(json.to));
  }

  /** The selected blocks. */
  blocks(): BlockRef[] {
    const blocks: BlockRef[] = [];
    let pos = this.from;
    this.$from.parent.content
      .cut(this.$from.parentOffset, this.$to.parentOffset)
      .forEach((node) => {
        blocks.push({ pos, node });
        pos += node.nodeSize;
      });
    return blocks;
  }
}

Selection.jsonID('tesseraBlockRange', BlockRangeSelection);

/** Every selectable block unit in document order (what arrow keys walk through). */
function blockUnits(doc: PMNode): BlockRef[] {
  const units: BlockRef[] = [];
  const seen = new Set<number>();
  doc.descendants((node, pos) => {
    if (node.isTextblock || node.isAtom) {
      const block =
        node.isAtom && node.isBlock ? blockAt(doc.resolve(pos)) : blockAt(doc.resolve(pos + 1));
      if (block && !seen.has(block.pos)) {
        seen.add(block.pos);
        units.push(block);
      }
      return false;
    }
    return true;
  });
  return units.sort((a, b) => a.pos - b.pos);
}

function selectBlock(state: EditorState, block: BlockRef): NodeSelection | null {
  return NodeSelection.isSelectable(block.node) ? NodeSelection.create(state.doc, block.pos) : null;
}

/** The selected blocks: a block range, a selected block, or none. */
export function selectedBlocks(state: EditorState): BlockRef[] {
  const { selection } = state;
  if (selection instanceof BlockRangeSelection) return selection.blocks();
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return [{ pos: selection.from, node: selection.node }];
  }
  return [];
}

const blockSelectionKey = new PluginKey('tesseraBlockSelection');

/**
 * Keyboard block operations: Escape selects the current block; ↑/↓ move between blocks while one
 * is selected, Shift+↑/↓ extend the selection over siblings; Delete and Backspace remove selected
 * blocks; Enter goes back to editing; Mod+D duplicates; Mod+Shift+↑/↓ move blocks; the context
 * menu key (or Shift+F10) opens the block menu.
 */
export function blockSelection(controller: EditorController) {
  return Extension.create({
    name: 'blockSelection',

    addKeyboardShortcuts() {
      const editor = this.editor;
      const dispatchSelection = (selection: Selection | null) => {
        if (!selection) return false;
        editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
        return true;
      };
      const step = (direction: 1 | -1) => {
        const selected = selectedBlocks(editor.state);
        if (!selected.length) return false;
        const units = blockUnits(editor.state.doc);
        const edge = direction === 1 ? selected[selected.length - 1] : selected[0];
        const index = units.findIndex((unit) => unit.pos === edge?.pos);
        const next = units[index + direction];
        if (index < 0 || !next) return true;
        return dispatchSelection(selectBlock(editor.state, next));
      };
      const extend = (direction: 1 | -1) => {
        const { selection, doc } = editor.state;
        let from: number;
        let to: number;
        if (selection instanceof BlockRangeSelection) {
          from = selection.from;
          to = selection.to;
        } else if (selection instanceof NodeSelection && selection.node.isBlock) {
          from = selection.from;
          to = selection.to;
        } else {
          return false;
        }
        const $from = doc.resolve(from);
        const parent = $from.parent;
        if (direction === 1) {
          const index = doc.resolve(to).index();
          if (index >= parent.childCount) return true;
          to += parent.child(index).nodeSize;
        } else {
          const index = $from.index();
          if (index === 0) return true;
          from -= parent.child(index - 1).nodeSize;
        }
        return dispatchSelection(new BlockRangeSelection(doc.resolve(from), doc.resolve(to)));
      };
      const selectionBlocks = () => {
        const selected = selectedBlocks(editor.state);
        if (selected.length) return selected;
        const block = currentBlock(editor);
        return block ? [block] : [];
      };

      return {
        Escape: () => {
          if (!editor.isEditable) return false;
          const { selection } = editor.state;
          if (selection instanceof NodeSelection || selection instanceof BlockRangeSelection)
            return false;
          const block = currentBlock(editor);
          if (!block) return false;
          return dispatchSelection(selectBlock(editor.state, block));
        },
        ArrowDown: () => step(1),
        ArrowUp: () => step(-1),
        'Shift-ArrowDown': () => extend(1),
        'Shift-ArrowUp': () => extend(-1),
        Backspace: () => {
          const { selection } = editor.state;
          if (selection instanceof BlockRangeSelection)
            return deleteBlocks(editor, selection.blocks());
          // At the start of a heading, Backspace turns it back into text (like Notion).
          const { $from } = selection;
          if (!selection.empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'heading')
            return false;
          const paragraph = editor.schema.nodes.paragraph;
          if (!paragraph) return false;
          const { blockId, color } = $from.parent.attrs;
          editor.view.dispatch(
            editor.state.tr.setBlockType($from.pos, $from.pos, paragraph, { blockId, color }),
          );
          return true;
        },
        Delete: () => {
          const { selection } = editor.state;
          if (selection instanceof BlockRangeSelection)
            return deleteBlocks(editor, selection.blocks());
          if (selection instanceof NodeSelection && selection.node.isBlock)
            return deleteBlocks(editor, [{ pos: selection.from, node: selection.node }]);
          return false;
        },
        Enter: () => {
          const { selection } = editor.state;
          if (!(selection instanceof NodeSelection) || !selection.node.isBlock) return false;
          const node = selection.node;
          if (node.isAtom) {
            // An image or embed: a new paragraph after it.
            const after = selection.to;
            const paragraph = editor.schema.nodes.paragraph?.create();
            if (!paragraph) return false;
            const tr = editor.state.tr.insert(after, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            editor.view.dispatch(ownUndoStep(tr).scrollIntoView());
            return true;
          }
          // Back to editing, at the end of the block's first line.
          const inside = Selection.findFrom(editor.state.doc.resolve(selection.from + 1), 1, true);
          if (!(inside instanceof TextSelection)) return false;
          return dispatchSelection(TextSelection.create(editor.state.doc, inside.$from.end()));
        },
        'Mod-d': () => {
          const blocks = selectionBlocks();
          const last = blocks[blocks.length - 1];
          if (!last || !editor.isEditable) return false;
          if (blocks.length === 1) return duplicateBlock(editor, last);
          const end = last.pos + last.node.nodeSize;
          const tr = editor.state.tr.insert(
            end,
            Fragment.fromArray(blocks.map((block) => block.node)),
          );
          editor.view.dispatch(ownUndoStep(tr).scrollIntoView());
          return true;
        },
        'Mod-Shift-ArrowUp': () => {
          const block = selectionBlocks()[0];
          return block && editor.isEditable ? moveBlock(editor, block, 'up') || true : false;
        },
        'Mod-Shift-ArrowDown': () => {
          const blocks = selectionBlocks();
          const block = blocks[blocks.length - 1];
          return block && editor.isEditable ? moveBlock(editor, block, 'down') || true : false;
        },
        ContextMenu: () => openMenu(),
        'Shift-F10': () => openMenu(),
      };

      function openMenu() {
        const block = selectedBlocks(editor.state)[0] ?? currentBlock(editor);
        if (!block || !editor.isEditable) return false;
        controller.blockMenu.set({ pos: block.pos, node: block.node, via: 'keyboard' });
        return true;
      }
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: blockSelectionKey,
          props: {
            decorations(state) {
              const { selection } = state;
              if (!(selection instanceof BlockRangeSelection)) return null;
              return DecorationSet.create(
                state.doc,
                selection.blocks().map((block) =>
                  Decoration.node(block.pos, block.pos + block.node.nodeSize, {
                    class: 'tess-block-selected',
                  }),
                ),
              );
            },
          },
        }),
      ];
    },
  });
}
