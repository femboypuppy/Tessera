import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const deferredScrollKey = new PluginKey('tesseraDeferredScroll');

/** Space kept between the selection and a scroller's edge (ProseMirror's default margin). */
const MARGIN = 5;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** How far to scroll so `rect` fits between `start` and `end` (0 when it already does). */
function delta(rectStart: number, rectEnd: number, start: number, end: number): number {
  if (rectStart < start + MARGIN) return rectStart - (start + MARGIN);
  if (rectEnd > end - MARGIN)
    return Math.min(rectEnd - (end - MARGIN), rectStart - (start + MARGIN));
  return 0;
}

/** Scrolls every scrolling ancestor of the editor (and the window) so `rect` is visible. */
export function scrollRectIntoView(view: EditorView, rect: Box): void {
  let box = { ...rect };
  for (let parent = view.dom.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const scrollsY =
      /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;
    const scrollsX =
      /(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
    if (!scrollsY && !scrollsX) continue;
    const bounds = parent.getBoundingClientRect();
    const dy = scrollsY ? delta(box.top, box.bottom, bounds.top, bounds.bottom) : 0;
    const dx = scrollsX ? delta(box.left, box.right, bounds.left, bounds.right) : 0;
    if (!dy && !dx) continue;
    const beforeTop = parent.scrollTop;
    const beforeLeft = parent.scrollLeft;
    parent.scrollTop += dy;
    parent.scrollLeft += dx;
    const movedY = parent.scrollTop - beforeTop;
    const movedX = parent.scrollLeft - beforeLeft;
    box = {
      top: box.top - movedY,
      bottom: box.bottom - movedY,
      left: box.left - movedX,
      right: box.right - movedX,
    };
  }
  const dy = delta(box.top, box.bottom, 0, window.innerHeight);
  const dx = delta(box.left, box.right, 0, window.innerWidth);
  if (dy || dx) window.scrollBy(dx, dy);
}

/** The box of the selection's head (or of the selected node). */
function selectionBox(view: EditorView): Box | null {
  const { selection } = view.state;
  if (selection instanceof NodeSelection) {
    const dom = view.nodeDOM(selection.from);
    return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
  }
  try {
    return view.coordsAtPos(selection.head, 1);
  } catch {
    // The position has no rendered DOM (inside a closed toggle, for instance).
    return null;
  }
}

/**
 * Scrolls the selection into view on the next animation frame instead of during the transaction.
 * ProseMirror measures the caret right after each change (typing included), which forces a full
 * synchronous layout of the page inside the key handler: on long pages that's most of the time a
 * keystroke takes. The browser lays out once per frame anyway, so measuring there costs nothing
 * extra, and the scroll still lands before the frame is painted.
 */
export const DeferredScroll = Extension.create({
  name: 'deferredScroll',

  addProseMirrorPlugins() {
    let frame = 0;
    let target: EditorView | null = null;
    const run = () => {
      frame = 0;
      const view = target;
      target = null;
      if (!view || view.isDestroyed) return;
      const box = selectionBox(view);
      if (box) scrollRectIntoView(view, box);
    };
    return [
      new Plugin({
        key: deferredScrollKey,
        props: {
          handleScrollToSelection(view) {
            target = view;
            if (!frame) frame = requestAnimationFrame(run);
            return true;
          },
        },
        view: () => ({
          destroy() {
            cancelAnimationFrame(frame);
            frame = 0;
            target = null;
          },
        }),
      }),
    ];
  },
});
