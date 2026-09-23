import type { EditorView } from '@tiptap/pm/view';
import type { BlockRef } from '../actions/blocks';
import type { EditorController } from '../react/controller';
import { dropTargetAt, moveBlockTo, type DropTarget } from './drop';
import { setDragSource } from './handle-plugin';

const DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 64;

/** The nearest scrolling ancestor of an element (or the window). */
function scrollParent(element: HTMLElement): HTMLElement | Window {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight)
      return current;
    current = current.parentElement;
  }
  return window;
}

/** A translucent copy of the block that follows the pointer (without live iframes). */
function createGhost(source: HTMLElement | null): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'tess-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  if (source) {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('iframe, video, audio').forEach((element) => element.remove());
    clone.removeAttribute('id');
    clone.classList.remove('tess-drag-source');
    ghost.style.width = `${Math.min(source.getBoundingClientRect().width, 640)}px`;
    // Inside an editor-styled wrapper, so the copy looks like the block.
    const styled = document.createElement('div');
    styled.className = 'tess-editor';
    styled.append(clone);
    ghost.append(styled);
  }
  return ghost;
}

/**
 * Starts a pointer-driven block drag from the handle. A small movement turns the press into a drag
 * with a following ghost, a drop indicator and edge auto-scrolling (all DOM, updated once per
 * frame); releasing moves the block in one undoable transaction. Escape cancels. A press without
 * movement is a click (`onClick` opens the block menu).
 */
export function startBlockDrag(
  view: EditorView,
  controller: EditorController,
  block: BlockRef,
  start: PointerEvent,
  onClick: () => void,
): void {
  const pointerId = start.pointerId;
  const startX = start.clientX;
  const startY = start.clientY;
  let x = startX;
  let y = startY;
  let dragging = false;
  let frame = 0;
  let target: DropTarget | null = null;
  let ghost: HTMLElement | null = null;
  const indicator = document.createElement('div');
  indicator.className = 'tess-drop-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const sourceDom = view.nodeDOM(block.pos);
  const source = sourceDom instanceof HTMLElement ? sourceDom : null;
  const scroller = scrollParent(view.dom);

  const scrollBounds = () =>
    scroller === window
      ? { top: 0, bottom: window.innerHeight }
      : (scroller as HTMLElement).getBoundingClientRect();

  const render = () => {
    frame = 0;
    if (!dragging) return;
    target = dropTargetAt(view, x, y, block);
    if (target) {
      indicator.style.display = 'block';
      indicator.style.width = `${target.line.width}px`;
      indicator.style.transform = `translate(${target.line.left}px, ${target.line.top - 1.5}px)`;
      indicator.dataset.nested = String(target.nested);
    } else {
      indicator.style.display = 'none';
    }
    if (ghost) ghost.style.transform = `translate(${x + 16}px, ${y + 12}px)`;
    // Scroll while the pointer rests near the top or bottom edge.
    const bounds = scrollBounds();
    let speed = 0;
    if (y < bounds.top + SCROLL_EDGE) speed = -Math.ceil((bounds.top + SCROLL_EDGE - y) / 4);
    else if (y > bounds.bottom - SCROLL_EDGE)
      speed = Math.ceil((y - (bounds.bottom - SCROLL_EDGE)) / 4);
    if (speed) {
      scroller.scrollBy(0, speed);
      frame = requestAnimationFrame(render);
    }
  };

  const begin = () => {
    dragging = true;
    controller.dragging.set(true);
    controller.blockMenu.set(null);
    document.body.classList.add('tess-block-dragging');
    ghost = createGhost(source);
    // Dimmed through a decoration: ProseMirror redraws nodes whose DOM is changed directly.
    setDragSource(view, block.pos);
    document.body.append(ghost, indicator);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(frame);
    ghost?.remove();
    indicator.remove();
    document.body.classList.remove('tess-block-dragging');
    if (dragging) {
      setDragSource(view, null);
      controller.dragging.set(false);
    }
  };

  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    x = event.clientX;
    y = event.clientY;
    if (!dragging && Math.hypot(x - startX, y - startY) > DRAG_THRESHOLD) begin();
    if (dragging && !frame) frame = requestAnimationFrame(render);
  }

  function onUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    const wasDragging = dragging;
    const drop = wasDragging ? dropTargetAt(view, event.clientX, event.clientY, block) : null;
    cleanup();
    if (!wasDragging) {
      onClick();
      return;
    }
    if (drop) moveBlockTo(view, block, drop.pos);
    view.focus();
  }

  function onCancel(event: PointerEvent) {
    if (event.pointerId === pointerId) cleanup();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && dragging) {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
