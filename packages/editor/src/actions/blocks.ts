import type { BlockColor } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode, type ResolvedPos, type Schema } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { COLOR_TYPES } from '../schema/attributes';

/** Block types a block can be turned into (the slash menu and the block menu's "Turn into"). */
export const TURN_INTO_TYPES = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'orderedList',
  'taskList',
  'toggle',
  'blockquote',
  'callout',
  'codeBlock',
] as const;
export type TurnIntoType = (typeof TURN_INTO_TYPES)[number];

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const ITEM_TYPES = new Set(['listItem', 'taskItem']);
const COLOR_TYPE_SET = new Set<string>(COLOR_TYPES);

/** A block the handle, the block menu and keyboard block operations act on. */
export interface BlockRef {
  pos: number;
  node: PMNode;
}

/** Node types that can be dragged and selected as blocks on their own. */
function isBlockUnit(node: PMNode, parent: PMNode | null): boolean {
  if (ITEM_TYPES.has(node.type.name)) return true;
  if (!node.type.isInGroup('block')) return false;
  if (LIST_TYPES.has(node.type.name)) return false; // lists move item by item
  if (!parent) return false;
  // Blocks inside table cells and code are part of their table.
  return !['tableCell', 'tableHeader', 'tableRow'].includes(parent.type.name);
}

/**
 * The block at a position: the innermost block unit containing it, except that the first child of
 * a list item, quote or callout stands for its container (they share the first line, so the
 * container is what the handle moves), and toggle summaries stand for their toggle.
 */
export function blockAt($pos: ResolvedPos): BlockRef | null {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    const parent = $pos.node(depth - 1);
    if (node.type.name === 'toggleSummary') continue;
    if (!isBlockUnit(node, parent)) continue;
    let resolvedDepth = depth;
    // Promote a first child to its container while the container is a block unit too.
    while (resolvedDepth > 1) {
      const container = $pos.node(resolvedDepth - 1);
      const grand = $pos.node(resolvedDepth - 2);
      const index = $pos.index(resolvedDepth - 1);
      const promotes =
        index === 0 &&
        (ITEM_TYPES.has(container.type.name) ||
          container.type.name === 'blockquote' ||
          container.type.name === 'callout') &&
        isBlockUnit(container, grand);
      if (!promotes) break;
      resolvedDepth -= 1;
    }
    return { pos: $pos.before(resolvedDepth), node: $pos.node(resolvedDepth) };
  }
  // Atom blocks (images, embeds, dividers) at the top level resolve through nodeAfter.
  const after = $pos.nodeAfter;
  if (after && after.isBlock && isBlockUnit(after, $pos.parent))
    return { pos: $pos.pos, node: after };
  return null;
}

/** The block the selection is in (or the selected block). */
export function currentBlock(editor: Editor): BlockRef | null {
  const { selection, doc } = editor.state;
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    const $pos = doc.resolve(selection.from);
    if (isBlockUnit(selection.node, $pos.parent))
      return { pos: selection.from, node: selection.node };
  }
  return blockAt(selection.$from);
}

function textblockAttrs(node: PMNode, type: string, schema: Schema): Record<string, unknown> {
  const spec = schema.nodes[type]?.spec.attrs ?? {};
  const attrs: Record<string, unknown> = {};
  if ('blockId' in spec) attrs.blockId = node.attrs.blockId ?? null;
  if ('color' in spec && COLOR_TYPE_SET.has(node.type.name)) attrs.color = node.attrs.color ?? null;
  return attrs;
}

/** Plain text with hard breaks for code (`\n`) → inline content, and the reverse. */
function inlineFromText(schema: Schema, text: string): Fragment {
  const nodes: PMNode[] = [];
  text.split('\n').forEach((line, index) => {
    if (index > 0 && schema.nodes.hardBreak) nodes.push(schema.nodes.hardBreak.create());
    if (line) nodes.push(schema.text(line));
  });
  return Fragment.from(nodes);
}

function textFromInline(fragment: Fragment): string {
  let text = '';
  fragment.forEach((child) => {
    if (child.isText) text += child.text ?? '';
    else if (child.type.name === 'hardBreak') text += '\n';
    else text += child.textContent;
  });
  return text;
}

/** Splits a block into its first line (inline content) and the blocks under it. */
function decompose(node: PMNode, schema: Schema): { inline: Fragment; rest: PMNode[] } {
  const name = node.type.name;
  if (name === 'codeBlock') return { inline: inlineFromText(schema, node.textContent), rest: [] };
  if (node.isTextblock) return { inline: node.content, rest: [] };
  const children: PMNode[] = [];
  node.forEach((child) => children.push(child));
  const first = children[0];
  if (first && first.isTextblock && first.type.name !== 'codeBlock') {
    return { inline: first.content, rest: children.slice(1) };
  }
  return { inline: Fragment.empty, rest: children };
}

/** Builds the nodes a block becomes. Returns null when the type can't be built. */
function compose(
  schema: Schema,
  type: TurnIntoType,
  source: PMNode,
  inline: Fragment,
  rest: PMNode[],
): PMNode[] | null {
  const { nodes } = schema;
  const paragraph = (content: Fragment) => nodes.paragraph?.create(null, content);
  const attrsFor = (name: string) => textblockAttrs(source, name, schema);
  try {
    switch (type) {
      case 'paragraph': {
        const node = nodes.paragraph?.create(attrsFor('paragraph'), inline);
        return node ? [node, ...rest] : null;
      }
      case 'heading1':
      case 'heading2':
      case 'heading3': {
        const level = Number(type.slice(-1));
        const node = nodes.heading?.create({ ...attrsFor('heading'), level }, inline);
        return node ? [node, ...rest] : null;
      }
      case 'codeBlock': {
        const text = textFromInline(inline);
        const node = nodes.codeBlock?.create(
          {
            ...attrsFor('codeBlock'),
            language: source.type.name === 'codeBlock' ? source.attrs.language : null,
          },
          text ? schema.text(text) : undefined,
        );
        return node ? [node, ...rest] : null;
      }
      case 'blockquote':
      case 'callout': {
        const first = paragraph(inline);
        if (!first) return null;
        const attrs =
          type === 'callout' && source.type.name === 'callout'
            ? { ...source.attrs }
            : attrsFor(type);
        const node = nodes[type]?.create(attrs, [first, ...rest]);
        return node ? [node] : null;
      }
      case 'toggle': {
        const summary = nodes.toggleSummary?.create(null, inline);
        if (!summary) return null;
        // A new toggle starts open, so Enter after its title writes inside it.
        const open = source.type.name === 'toggle' ? source.attrs.open : true;
        const node = nodes.toggle?.create({ ...attrsFor('toggle'), open }, [summary, ...rest]);
        return node ? [node] : null;
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const itemType = type === 'taskList' ? 'taskItem' : 'listItem';
        const first = paragraph(inline);
        if (!first) return null;
        const itemAttrs: Record<string, unknown> = attrsFor(itemType);
        if (itemType === 'taskItem')
          itemAttrs.checked = source.type.name === 'taskItem' ? source.attrs.checked : false;
        const item = nodes[itemType]?.create(itemAttrs, [first, ...rest]);
        const list = item ? nodes[type]?.create(null, item) : null;
        return list ? [list] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** The list type a block converts to, or null when it is not a list. */
function listTypeOf(type: TurnIntoType): string | null {
  return type === 'bulletList' || type === 'orderedList' || type === 'taskList' ? type : null;
}

/** The type id of a block, for "Turn into" checkmarks. */
export function turnIntoTypeOf(block: PMNode, parent: PMNode | null): TurnIntoType | null {
  switch (block.type.name) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return `heading${Math.min(3, Math.max(1, Number(block.attrs.level) || 1))}` as TurnIntoType;
    case 'listItem':
      return parent?.type.name === 'orderedList' ? 'orderedList' : 'bulletList';
    case 'taskItem':
      return 'taskList';
    case 'toggle':
    case 'blockquote':
    case 'callout':
    case 'codeBlock':
      return block.type.name as TurnIntoType;
    default:
      return null;
  }
}

/**
 * Builds a transaction turning the block at `pos` into `type`, keeping its text, the blocks under
 * it, its ID and its color. A list item leaves its list (which is split around it) unless it only
 * changes list type. Returns null when the conversion isn't possible there.
 */
export function turnIntoTransaction(
  tr: Transaction,
  pos: number,
  type: TurnIntoType,
): Transaction | null {
  const { doc } = tr;
  const node = doc.nodeAt(pos);
  if (!node) return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const schema = doc.type.schema;
  const { inline, rest } = decompose(node, schema);
  const converted = compose(schema, type, node, inline, rest);
  if (!converted) return null;

  let from = pos;
  let to = pos + node.nodeSize;
  let replacement: PMNode[] = converted;

  if (ITEM_TYPES.has(node.type.name) && LIST_TYPES.has(parent.type.name)) {
    // Split the list around the item.
    const listPos = $pos.before();
    const index = $pos.index();
    const items: PMNode[] = [];
    parent.forEach((child) => items.push(child));
    const before = items.slice(0, index);
    const after = items.slice(index + 1);
    const pieces: PMNode[] = [];
    if (before.length) pieces.push(parent.copy(Fragment.from(before)));
    pieces.push(...converted);
    if (after.length) pieces.push(parent.copy(Fragment.from(after)));
    replacement = pieces;
    from = listPos;
    to = listPos + parent.nodeSize;
  }

  const $from = doc.resolve(from);
  const index = $from.index();
  const container = $from.parent;
  const endIndex = doc.resolve(to).index();
  if (!container.canReplace(index, endIndex, Fragment.from(replacement))) return null;

  tr.replaceWith(from, to, replacement);

  // The caret goes to the end of the converted block's first line.
  let convertedStart = from;
  const firstConverted = replacement.indexOf(converted[0] as PMNode);
  for (let i = 0; i < firstConverted; i += 1) convertedStart += replacement[i]?.nodeSize ?? 0;
  let caret: number | null = null;
  const convertedNode = tr.doc.nodeAt(convertedStart);
  convertedNode?.descendants((child, offset) => {
    if (caret !== null) return false;
    if (child.isTextblock) {
      caret = convertedStart + 1 + offset + 1 + child.content.size;
      return false;
    }
    return true;
  });
  if (caret === null && convertedNode?.isTextblock)
    caret = convertedStart + 1 + convertedNode.content.size;

  // Join with neighboring lists of the same type, like typing "- " next to a list.
  const listType = listTypeOf(type);
  const joinsFrom = tr.mapping.maps.length;
  if (listType && convertedNode?.type.name === listType) {
    const listEnd = convertedStart + convertedNode.nodeSize;
    if (tr.doc.resolve(listEnd).nodeAfter?.type === convertedNode.type) tr.join(listEnd);
    if (tr.doc.resolve(convertedStart).nodeBefore?.type === convertedNode.type)
      tr.join(convertedStart);
  }
  if (caret !== null) {
    const mapped = tr.mapping.slice(joinsFrom).map(caret);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(mapped, tr.doc.content.size)), -1));
  }
  return tr;
}

/** Turns the block at `pos` into `type`. Returns false when it isn't possible there. */
export function turnInto(editor: Editor, pos: number, type: TurnIntoType): boolean {
  const tr = turnIntoTransaction(editor.state.tr, pos, type);
  if (!tr) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** True when the block at `pos` can be turned into `type`. */
export function canTurnInto(editor: Editor, pos: number, type: TurnIntoType): boolean {
  return turnIntoTransaction(editor.state.tr, pos, type) !== null;
}

/**
 * The block a slash command acts on: the textblock with the caret when the new block may replace
 * it where it is, otherwise its container (a list item's first line turns the whole item).
 */
export function slashTarget(editor: Editor, type: TurnIntoType): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'toggleSummary') continue;
    const pos = $from.before(depth);
    if (!node.isTextblock && !ITEM_TYPES.has(node.type.name) && !node.type.isInGroup('block')) {
      return null;
    }
    if (canTurnInto(editor, pos, type)) return pos;
    if (['tableCell', 'tableHeader', 'tableRow', 'table'].includes(node.type.name)) return null;
  }
  return null;
}

/** Duplicates a block right after itself (the copy gets new block IDs). */
export function duplicateBlock(editor: Editor, block: BlockRef): boolean {
  const end = block.pos + block.node.nodeSize;
  const tr = editor.state.tr.insert(end, block.node);
  const selected = tr.doc.nodeAt(end);
  if (selected && NodeSelection.isSelectable(selected))
    tr.setSelection(NodeSelection.create(tr.doc, end));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Deletes a block (and an emptied list or container around it). */
export function deleteBlocks(editor: Editor, blocks: readonly BlockRef[]): boolean {
  if (!blocks.length) return false;
  const tr = editor.state.tr;
  const sorted = [...blocks].sort((a, b) => b.pos - a.pos);
  for (const block of sorted) {
    const from = tr.mapping.map(block.pos);
    const to = tr.mapping.map(block.pos + block.node.nodeSize);
    tr.deleteRange(from, to);
  }
  if (tr.doc.childCount === 0 && tr.doc.type.schema.nodes.paragraph) {
    tr.insert(0, tr.doc.type.schema.nodes.paragraph.create());
  }
  const anchor = Math.min(tr.mapping.map(sorted[sorted.length - 1]?.pos ?? 0), tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(anchor), -1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Sets or clears a block's color (text or background). */
export function setBlockColor(editor: Editor, block: BlockRef, color: BlockColor | null): boolean {
  if (!COLOR_TYPE_SET.has(block.node.type.name)) return false;
  editor.view.dispatch(editor.state.tr.setNodeAttribute(block.pos, 'color', color));
  return true;
}

/** Joins the list ending right before `pos` with the list starting at `pos` when they match. */
export function joinListsAt(tr: Transaction, pos: number): void {
  if (pos <= 0 || pos >= tr.doc.content.size) return;
  const $pos = tr.doc.resolve(pos);
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  if (before && after && LIST_TYPES.has(before.type.name) && before.type === after.type) {
    tr.join(pos);
  }
}

/**
 * Moves a block one step up or down (Mod+Shift+Up/Down), keeping the caret or the block selection.
 * Lists behave like runs of separate blocks: an item at the edge of its list steps over the
 * neighboring block (staying a list item), another block steps over one list item at a time, and
 * lists that end up next to each other merge. At the edge of a quote, callout or toggle the block
 * moves out of it.
 */
export function moveBlock(editor: Editor, block: BlockRef, direction: 'up' | 'down'): boolean {
  const { doc } = editor.state;
  const up = direction === 'up';
  const $pos = doc.resolve(block.pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const isItem = ITEM_TYPES.has(block.node.type.name);
  let target: number;
  let splitList = false;

  const siblingIndex = up ? index - 1 : index + 1;
  if (siblingIndex >= 0 && siblingIndex < parent.childCount) {
    const sibling = parent.child(siblingIndex);
    const siblingPos = up ? block.pos - sibling.nodeSize : block.pos + block.node.nodeSize;
    if (!isItem && LIST_TYPES.has(sibling.type.name) && sibling.childCount > 1) {
      // Step over one item of the neighboring list by splitting it there.
      const edgeItem = up ? sibling.lastChild : sibling.firstChild;
      target = up
        ? siblingPos + sibling.nodeSize - 1 - (edgeItem?.nodeSize ?? 0)
        : siblingPos + 1 + (edgeItem?.nodeSize ?? 0);
      splitList = true;
    } else {
      target = up ? siblingPos : siblingPos + sibling.nodeSize;
    }
  } else if (isItem && $pos.depth > 0) {
    // First or last item: leave the list, stepping over the block next to the list.
    const listPos = $pos.before();
    const $list = doc.resolve(listPos);
    const container = $list.parent;
    const neighborIndex = up ? $list.index() - 1 : $list.index() + 1;
    if (neighborIndex >= 0 && neighborIndex < container.childCount) {
      const neighbor = container.child(neighborIndex);
      target = up ? listPos - neighbor.nodeSize : listPos + parent.nodeSize + neighbor.nodeSize;
    } else if ($list.depth > 0) {
      target = up ? $list.before() : $list.after();
    } else {
      return false;
    }
  } else if ($pos.depth > 0) {
    target = up ? $pos.before() : $pos.after();
  } else {
    return false;
  }

  const selection = editor.state.selection;
  const offsetInBlock =
    selection.from >= block.pos && selection.from <= block.pos + block.node.nodeSize
      ? selection.from - block.pos
      : null;
  const wasNodeSelection = selection instanceof NodeSelection;

  const tr = editor.state.tr;
  tr.deleteRange(block.pos, block.pos + block.node.nodeSize);
  // Lists that the block used to separate become one again.
  joinListsAt(tr, tr.mapping.map(block.pos, -1));
  let insertAt = tr.mapping.map(target, up ? -1 : 1);
  if (splitList) {
    tr.split(insertAt);
    insertAt += 1;
  }
  const $insert = tr.doc.resolve(insertAt);
  const content = adaptForParent(block.node, $insert.parent, parent);
  if (!content || !$insert.parent.canReplace($insert.index(), $insert.index(), content))
    return false;
  tr.insert(insertAt, content);
  const wrapped = content.firstChild !== null && content.firstChild.type !== block.node.type;
  // Track the moved block through the list joins that follow.
  let movedPos = wrapped ? insertAt + 1 : insertAt;
  const mapFrom = tr.mapping.maps.length;
  joinListsAt(tr, insertAt + content.size);
  joinListsAt(tr, insertAt);
  movedPos = tr.mapping.slice(mapFrom).map(movedPos, 1);

  const moved = tr.doc.nodeAt(movedPos);
  if (moved && moved.type === block.node.type) {
    if (wasNodeSelection && NodeSelection.isSelectable(moved))
      tr.setSelection(NodeSelection.create(tr.doc, movedPos));
    else if (offsetInBlock !== null) {
      const pos = Math.min(movedPos + offsetInBlock, movedPos + moved.nodeSize - 1);
      tr.setSelection(Selection.near(tr.doc.resolve(pos)));
    }
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Adapts a block for a new parent: list items leaving a list are wrapped in a list of their old
 * type, blocks entering a list become items, and bullet/task items convert between each other.
 */
export function adaptForParent(
  node: PMNode,
  target: PMNode,
  origin: PMNode | null,
): Fragment | null {
  const schema = target.type.schema;
  const { nodes } = schema;
  const isItem = ITEM_TYPES.has(node.type.name);
  const targetIsList = LIST_TYPES.has(target.type.name);
  if (targetIsList) {
    const itemType = target.type.name === 'taskList' ? 'taskItem' : 'listItem';
    if (isItem) {
      if (node.type.name === itemType) return Fragment.from(node);
      const attrs: Record<string, unknown> = {
        blockId: node.attrs.blockId,
        color: node.attrs.color,
      };
      if (itemType === 'taskItem') attrs.checked = false;
      const item = nodes[itemType]?.create(attrs, node.content);
      return item ? Fragment.from(item) : null;
    }
    const { inline, rest } = decompose(node, schema);
    const first = node.isTextblock
      ? nodes.paragraph?.create(null, inline)
      : nodes.paragraph?.create();
    if (!first) return null;
    const children = node.isTextblock ? [first, ...rest] : [first, node];
    const item = nodes[itemType]?.create(
      itemType === 'taskItem' ? { checked: false } : null,
      children,
    );
    return item ? Fragment.from(item) : null;
  }
  if (isItem) {
    const listType =
      node.type.name === 'taskItem'
        ? 'taskList'
        : origin?.type.name === 'orderedList'
          ? 'orderedList'
          : 'bulletList';
    const list = nodes[listType]?.create(null, node);
    return list ? Fragment.from(list) : null;
  }
  return Fragment.from(node);
}

/** A new empty paragraph after a block, with the caret in it (the "+" button). */
export function insertParagraphAfter(editor: Editor, block: BlockRef): boolean {
  const $pos = editor.state.doc.resolve(block.pos);
  const parent = $pos.parent;
  const schema = editor.schema;
  const end = block.pos + block.node.nodeSize;
  let node: PMNode | null | undefined;
  if (LIST_TYPES.has(parent.type.name)) {
    const itemType = parent.type.name === 'taskList' ? 'taskItem' : 'listItem';
    node = schema.nodes[itemType]?.create(null, schema.nodes.paragraph?.create());
  } else {
    node = schema.nodes.paragraph?.create();
  }
  if (!node) return false;
  const tr = editor.state.tr.insert(end, node);
  tr.setSelection(TextSelection.create(tr.doc, end + (node.isTextblock ? 1 : 2)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/**
 * Inserts blocks where the caret is: an empty paragraph with the caret is replaced, otherwise the
 * blocks go after the current block. When the last inserted block holds no text, an empty
 * paragraph follows so there's always somewhere to keep typing.
 */
export function insertBlocks(editor: Editor, at: number, blocks: PMNode[]): boolean {
  if (!blocks.length) return false;
  const { doc } = editor.state;
  const $at = doc.resolve(Math.min(Math.max(at, 0), doc.content.size));
  const tr = editor.state.tr;
  let from: number;
  let to: number;
  const parent = $at.parent;
  if (parent.isTextblock && parent.type.name === 'paragraph' && parent.content.size === 0) {
    from = $at.before();
    to = $at.after();
  } else if (parent.isTextblock) {
    from = to = $at.after();
  } else {
    from = to = $at.pos;
  }
  const $from = doc.resolve(from);
  const content = [...blocks];
  const last = content[content.length - 1];
  const afterNode = doc.resolve(to).nodeAfter;
  if (
    last &&
    !last.isTextblock &&
    !(afterNode?.type.name === 'paragraph') &&
    editor.schema.nodes.paragraph
  ) {
    content.push(editor.schema.nodes.paragraph.create());
  }
  if (!$from.parent.canReplace($from.index(), doc.resolve(to).index(), Fragment.from(content))) {
    return false;
  }
  tr.replaceWith(from, to, content);
  const insertedEnd = from + content.reduce((size, node) => size + node.nodeSize, 0);
  const firstInserted = tr.doc.nodeAt(from);
  if (firstInserted?.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, from + 1 + firstInserted.content.size));
  } else {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(insertedEnd, tr.doc.content.size)), -1));
    const lastInserted = tr.doc.resolve(insertedEnd).nodeBefore;
    if (lastInserted?.type.name === 'paragraph' && lastInserted.content.size === 0) {
      tr.setSelection(TextSelection.create(tr.doc, insertedEnd - 1));
    }
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
