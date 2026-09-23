import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { blockAt } from '../actions/blocks';
import type { EditorController } from '../react/controller';
import { blockAtCoords } from './drop';

export const blockHandleKey = new PluginKey<number | null>('tesseraBlockHandle');

/** Marks (or unmarks, with null) the block being dragged, so it renders dimmed. */
export function setDragSource(view: EditorView, pos: number | null): void {
  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(blockHandleKey, pos));
}

/** True on touch-first devices, where the handle follows the caret instead of the pointer. */
export function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)
  );
}

/**
 * Tracks the block under the pointer (the gutter to the left of the page counts), so the handle can
 * sit next to it. Typing hides the handle until the pointer moves again. On touch screens the
 * handle follows the caret's block instead.
 */
export function blockHandle(controller: EditorController) {
  return Extension.create({
    name: 'blockHandle',

    addProseMirrorPlugins() {
      return [
        new Plugin<number | null>({
          key: blockHandleKey,
          state: {
            init: () => null,
            apply(tr, value) {
              const meta = tr.getMeta(blockHandleKey) as number | null | undefined;
              if (meta !== undefined) return meta;
              return value === null ? null : tr.mapping.map(value);
            },
          },
          view(view: EditorView) {
            let frame = 0;
            let x = 0;
            let y = 0;
            let tracking = false;
            const coarse = isCoarsePointer();

            const update = () => {
              frame = 0;
              if (controller.dragging.get() || controller.blockMenu.get()) return;
              if (!view.editable || !tracking) {
                controller.handle.set(null);
                return;
              }
              const box = view.dom.getBoundingClientRect();
              const inside =
                y >= box.top - 2 &&
                y <= box.bottom + 2 &&
                x >= box.left - 110 &&
                x <= box.right + 40;
              if (!inside) {
                controller.handle.set(null);
                return;
              }
              const current = controller.handle.get();
              // Moving left toward the handle (over list markers, a toggle's chevron, the gutter)
              // keeps the handle on its block as long as the pointer stays on that block's band.
              if (current && view.state.doc.nodeAt(current.pos) === current.node) {
                const dom = view.nodeDOM(current.pos);
                const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
                if (rect && x < rect.left && y >= rect.top && y <= rect.bottom) return;
              }
              const block = blockAtCoords(view, x, y);
              if (!block) controller.handle.set(null);
              else if (!current || current.pos !== block.pos || current.node !== block.node)
                controller.handle.set(block);
            };
            const schedule = () => {
              if (!frame) frame = requestAnimationFrame(update);
            };
            const onMove = (event: MouseEvent) => {
              x = event.clientX;
              y = event.clientY;
              tracking = true;
              schedule();
            };
            const onLeave = () => {
              tracking = false;
              schedule();
            };
            const followCaret = () => {
              if (controller.blockMenu.get()) return;
              const block =
                view.hasFocus() && view.editable ? blockAt(view.state.selection.$from) : null;
              const current = controller.handle.get();
              if (!block) controller.handle.set(null);
              else if (!current || current.pos !== block.pos || current.node !== block.node)
                controller.handle.set(block);
            };

            if (!coarse) {
              document.addEventListener('mousemove', onMove, { passive: true });
              document.documentElement.addEventListener('mouseleave', onLeave);
            }
            return {
              update(nextView, previous) {
                if (coarse) {
                  followCaret();
                  return;
                }
                // Positions shift when the document changes: find the block again.
                if (nextView.state.doc !== previous.doc && controller.handle.get()) schedule();
              },
              destroy() {
                cancelAnimationFrame(frame);
                if (!coarse) {
                  document.removeEventListener('mousemove', onMove);
                  document.documentElement.removeEventListener('mouseleave', onLeave);
                }
                controller.handle.set(null);
              },
            };
          },
          props: {
            decorations(state) {
              const pos = blockHandleKey.getState(state);
              const node = pos === null || pos === undefined ? null : state.doc.nodeAt(pos);
              if (pos === null || pos === undefined || !node) return null;
              return DecorationSet.create(state.doc, [
                Decoration.node(pos, pos + node.nodeSize, { class: 'tess-drag-source' }),
              ]);
            },
            handleKeyDown: () => {
              // Typing hides the handle (it comes back when the pointer moves).
              if (!isCoarsePointer() && controller.handle.get() && !controller.blockMenu.get())
                controller.handle.set(null);
              return false;
            },
            handleDOMEvents: {
              focus: (view) => {
                if (isCoarsePointer()) {
                  const block = blockAt(view.state.selection.$from);
                  controller.handle.set(block);
                }
                return false;
              },
            },
          },
        }),
      ];
    },
  });
}
