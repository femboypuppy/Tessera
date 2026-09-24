import { headingSlug } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';

/**
 * Puts the caret at the start or end of the body. Enter in the title lands in the first block;
 * when the page starts with something that holds no text (an image, a table), an empty paragraph
 * is inserted above it so there's somewhere to type.
 */
export function focusBody(editor: Editor, position: 'start' | 'end'): void {
  if (editor.isDestroyed) return;
  const { view } = editor;
  const tr = view.state.tr;
  if (position === 'end') {
    tr.setSelection(Selection.atEnd(tr.doc));
  } else {
    const first = tr.doc.firstChild;
    if (!first?.isTextblock && editor.isEditable && editor.schema.nodes.paragraph) {
      tr.insert(0, editor.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, 1));
    } else {
      tr.setSelection(Selection.atStart(tr.doc));
    }
  }
  view.dispatch(tr.scrollIntoView());
  // Focus now, not on the next frame (TipTap's `focus` command waits a frame): the key typed
  // right after Enter in the title must land in the body.
  view.focus();
}

/** Finds the position of a navigation target: a heading (text or slug) or a block ID. */
export function findTarget(
  doc: PMNode,
  target: { heading?: string; blockId?: string },
): number | null {
  let found: number | null = null;
  const wantedSlug = target.heading ? headingSlug(target.heading) : null;
  const wantedText = target.heading?.trim().toLowerCase() ?? null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (target.blockId && node.attrs.blockId === target.blockId) {
      found = pos;
      return false;
    }
    if (wantedSlug !== null && node.type.name === 'heading') {
      const text = node.textContent;
      if (text.trim().toLowerCase() === wantedText || headingSlug(text) === wantedSlug) {
        found = pos;
        return false;
      }
    }
    return !node.isTextblock;
  });
  return found;
}

/** Scrolls to a target block, briefly highlights it and puts the caret (or selection) there. */
export function revealTarget(
  editor: Editor,
  target: { heading?: string; blockId?: string },
): boolean {
  const pos = findTarget(editor.state.doc, target);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  const dom = editor.view.nodeDOM(pos);
  if (!node || !(dom instanceof HTMLElement)) return false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  dom.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  dom.classList.add('tess-flash');
  window.setTimeout(() => dom.classList.remove('tess-flash'), 1600);
  const selection = node.isTextblock
    ? TextSelection.create(editor.state.doc, pos + 1)
    : NodeSelection.create(editor.state.doc, pos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return true;
}

/** Adds an empty paragraph at the end (unless there is one) and puts the caret in it. */
export function focusTail(editor: Editor): void {
  if (!editor.isEditable) return;
  const last = editor.state.doc.lastChild;
  if (last && last.type.name === 'paragraph' && last.content.size === 0) {
    editor.commands.focus('end');
    return;
  }
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, { type: 'paragraph' })
    .setTextSelection(end + 1)
    .focus()
    .run();
}
