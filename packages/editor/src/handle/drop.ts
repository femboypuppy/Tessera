import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { adaptForParent, blockAt, joinListsAt, type BlockRef } from '../actions/blocks';

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const ITEM_TYPES = new Set(['listItem', 'taskItem']);
const NESTING_CONTAINERS = new Set(['listItem', 'taskItem', 'callout', 'blockquote']);
/** How far right of a block's text the pointer must be to nest into it. */
export const NEST_OFFSET = 36;

/** Where a dragged block would land. */
export interface DropTarget {
  /** Insertion position in the current document. */
  pos: number;
  /** The indicator line, in viewport coordinates. */
  line: { left: number; top: number; width: number };
  /** True when the block goes inside a toggle or list item (the indicator is indented). */
  nested: boolean;
}

function isBlockUnitNode(node: PMNode, parent: PMNode): boolean {
  if (ITEM_TYPES.has(node.type.name)) return true;
  if (!node.type.isInGroup('block') || LIST_TYPES.has(node.type.name)) return false;
  return !['tableCell', 'tableHeader', 'tableRow'].includes(parent.type.name);
}

/** The box of the node at `pos`, or null when it has no DOM or is hidden (a closed toggle's body). */
function visibleRect(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

/**
 * The child of `parent` (whose content starts at `start`) at height `y`: the last visible child
 * that starts at or above it, so the gap below a block belongs to that block, or the first one
 * when `y` is above them all. A binary search over the children's boxes, falling back to a scan
 * when it meets a hidden child.
 */
function childAtY(
  view: EditorView,
  parent: PMNode,
  start: number,
  y: number,
): { node: PMNode; pos: number } | null {
  const offsets: number[] = [];
  parent.forEach((_child, offset) => offsets.push(offset));
  const at = (index: number) => {
    const offset = offsets[index] ?? 0;
    const node = parent.child(index);
    return { node, pos: start + offset };
  };
  const scan = () => {
    let found: number | null = null;
    let first: number | null = null;
    for (let index = 0; index < offsets.length; index += 1) {
      const rect = visibleRect(view, at(index).pos);
      if (!rect) continue;
      first ??= index;
      if (rect.top <= y) found = index;
      else break;
    }
    const index = found ?? first;
    return index === null ? null : at(index);
  };
  let low = 0;
  let high = offsets.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const rect = visibleRect(view, at(middle).pos);
    if (!rect) return scan();
    if (rect.top <= y) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (found >= 0) return at(found);
  return visibleRect(view, at(0).pos) ? at(0) : scan();
}

/**
 * The block at height `y`: the innermost block unit whose box spans it (see `blockAt`), found by a
 * binary search over block boxes from the top level down. Unlike `posAtCoords`, this needs no hit
 * testing, so it stays cheap on pages with thousands of blocks (it runs every frame of a drag and
 * on every hover).
 */
export function blockAtY(view: EditorView, y: number): BlockRef | null {
  const { doc } = view.state;
  let parent: PMNode = doc;
  let start = 0;
  for (;;) {
    const child = childAtY(view, parent, start, y);
    if (!child) return null;
    const { node, pos } = child;
    if (node.isAtom) {
      const $pos = doc.resolve(pos);
      return node.isBlock && isBlockUnitNode(node, $pos.parent) ? { pos, node } : blockAt($pos);
    }
    // Tables move as a whole; everything else with blocks inside is searched further.
    if (!node.isTextblock && node.childCount > 0 && node.type.name !== 'table') {
      parent = node;
      start = pos + 1;
      continue;
    }
    return blockAt(doc.resolve(pos + 1));
  }
}

function elementRect(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
}

/** True when `pos` lies inside the dragged block (dropping there is a no-op or impossible). */
function insideDragged(pos: number, dragged: BlockRef): boolean {
  return pos > dragged.pos && pos < dragged.pos + dragged.node.nodeSize;
}

/** True when the dragged block can be inserted at `pos` (adapted to the parent there). */
export function canDropAt(state: EditorState, pos: number, dragged: BlockRef): boolean {
  if (insideDragged(pos, dragged)) return false;
  if (pos === dragged.pos || pos === dragged.pos + dragged.node.nodeSize) return false;
  const $pos = state.doc.resolve(pos);
  const origin = state.doc.resolve(dragged.pos).parent;
  const content = adaptForParent(dragged.node, $pos.parent, origin);
  return !!content && $pos.parent.canReplace($pos.index(), $pos.index(), content);
}

/**
 * Computes where a block dragged to (x, y) would land: before or after the block under the
 * pointer, or inside a toggle (or a list item, quote or callout) when the pointer is over the lower
 * half of its first line and to the right of its text start. Returns null over the dragged block
 * itself or where it can't go.
 */
export function dropTargetAt(
  view: EditorView,
  x: number,
  y: number,
  dragged: BlockRef,
): DropTarget | null {
  const { state } = view;
  const editorBox = view.dom.getBoundingClientRect();
  // Below the last block: the end of the document.
  if (y > editorBox.bottom - 4) {
    const pos = state.doc.content.size;
    const last = state.doc.lastChild;
    const lastRect = last ? elementRect(view, pos - last.nodeSize) : null;
    if (!canDropAt(state, pos, dragged)) return null;
    return {
      pos,
      nested: false,
      line: {
        left: editorBox.left,
        top: lastRect?.bottom ?? editorBox.bottom,
        width: editorBox.width,
      },
    };
  }
  const block = blockAtY(view, y);
  if (!block) return null;
  if (block.pos === dragged.pos || insideDragged(block.pos, dragged)) return null;
  const rect = elementRect(view, block.pos);
  if (!rect) return null;

  // Nesting: the lower half of the first line of a toggle or container, right of its text start.
  const firstChild = block.node.firstChild;
  const isToggle = block.node.type.name === 'toggle';
  if ((isToggle || NESTING_CONTAINERS.has(block.node.type.name)) && firstChild?.isTextblock) {
    const firstPos = block.pos + 1;
    const lineRect = elementRect(view, firstPos);
    if (
      lineRect &&
      y > lineRect.top + lineRect.height / 2 &&
      y <= lineRect.bottom + 2 &&
      x > lineRect.left + NEST_OFFSET
    ) {
      const open = !isToggle || block.node.attrs.open === true;
      const pos = open ? firstPos + firstChild.nodeSize : block.pos + block.node.nodeSize - 1;
      if (canDropAt(state, pos, dragged)) {
        const indent = isToggle ? lineRect.left : lineRect.left + 24;
        return {
          pos,
          nested: true,
          line: { left: indent, top: lineRect.bottom, width: Math.max(40, rect.right - indent) },
        };
      }
    }
  }

  const before = y < rect.top + rect.height / 2;
  const pos = before ? block.pos : block.pos + block.node.nodeSize;
  if (!canDropAt(state, pos, dragged)) return null;
  return {
    pos,
    nested: false,
    line: { left: rect.left, top: before ? rect.top : rect.bottom, width: rect.width },
  };
}

/**
 * Moves a block to `target` in one transaction (so it's one undo step and the block keeps its ID),
 * adapting it to its new parent, then selects it.
 */
export function moveBlockTo(view: EditorView, dragged: BlockRef, target: number): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(dragged.pos);
  if (!node || node !== dragged.node) return false;
  const origin = state.doc.resolve(dragged.pos).parent;
  const tr = state.tr;
  // Insert first, then delete the original (mapped), so the target position stays exact.
  const $target = state.doc.resolve(target);
  const content = adaptForParent(node, $target.parent, origin);
  if (!content || !$target.parent.canReplace($target.index(), $target.index(), content))
    return false;
  tr.insert(target, content);
  const from = tr.mapping.map(dragged.pos);
  const to = tr.mapping.map(dragged.pos + node.nodeSize);
  tr.deleteRange(from, to);
  // Lists the block used to separate merge again.
  joinListsAt(tr, tr.mapping.slice(1).map(from, -1));
  const inserted = tr.mapping.slice(1).map(target, 1);
  const wrapped = content.firstChild !== null && content.firstChild.type !== node.type;
  // Track the moved block (inside its list wrapper when it got one) through list joins.
  let movedPos = wrapped ? inserted + 1 : inserted;
  const joinsFrom = tr.mapping.maps.length;
  joinListsAt(tr, inserted + content.size);
  joinListsAt(tr, inserted);
  movedPos = tr.mapping.slice(joinsFrom).map(movedPos, 1);
  const moved = tr.doc.nodeAt(movedPos);
  if (moved && NodeSelection.isSelectable(moved))
    tr.setSelection(NodeSelection.create(tr.doc, movedPos));
  else if (moved) tr.setSelection(Selection.near(tr.doc.resolve(movedPos + 1)));
  else tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(inserted, tr.doc.content.size))));
  tr.setMeta('uiEvent', 'drop');
  view.dispatch(tr.scrollIntoView());
  return true;
}
