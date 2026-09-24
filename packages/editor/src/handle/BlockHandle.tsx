import { cn, DropdownMenu, DropdownMenuTrigger } from '@tessera/ui';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { GripVertical, Plus } from 'lucide-react';
import {
  useCallback,
  useLayoutEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { insertParagraphAfter, type BlockRef } from '../actions/blocks';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import { useStore } from '../react/store';
import { BlockMenuContent } from './BlockMenu';
import { startBlockDrag } from './drag';
import { isCoarsePointer } from './handle-plugin';

const ITEM_TYPES = new Set(['listItem', 'taskItem']);
const HANDLE_WIDTH = 46;

/** The block's first line box, which the handle lines up with. */
function firstLineRect(editor: Editor, block: BlockRef): DOMRect | null {
  const dom = editor.view.nodeDOM(block.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  let lineTop = rect.top;
  let lineHeight = Math.min(rect.height, 30);
  // Text blocks (and containers starting with text): use the first line of text.
  const textStart = block.node.isTextblock
    ? block.pos + 1
    : block.node.firstChild?.isTextblock
      ? block.pos + 2
      : null;
  if (textStart !== null) {
    try {
      const coords = editor.view.coordsAtPos(Math.min(textStart, editor.state.doc.content.size));
      lineTop = coords.top;
      lineHeight = coords.bottom - coords.top;
    } catch {
      // Keep the element's top edge.
    }
  }
  const indent = ITEM_TYPES.has(block.node.type.name) ? 22 : 0;
  return new DOMRect(rect.left - indent, lineTop, rect.width + indent, lineHeight);
}

/**
 * The block handle: "+" adds a block below, the grip drags the block (or opens the block menu on
 * click or Enter). On touch screens it follows the caret's block and is a larger tap target.
 */
export function BlockHandle({
  controller,
  editor,
  root,
}: {
  controller: EditorController;
  editor: Editor;
  /** The editor root; the handle is positioned inside it, so it scrolls with the page. */
  root: RefObject<HTMLElement | null>;
}) {
  const hovered = useStore(controller.handle);
  const menu = useStore(controller.blockMenu);
  const dragging = useStore(controller.dragging);
  const readOnly = useStore(controller.readOnly);
  const block: BlockRef | null = menu ?? hovered;
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const coarse = isCoarsePointer();

  const place = useCallback(() => {
    if (!block || editor.isDestroyed) {
      setPosition(null);
      return;
    }
    const current = editor.state.doc.nodeAt(block.pos);
    if (!current || current.type !== block.node.type) {
      setPosition(null);
      return;
    }
    const line = firstLineRect(editor, block);
    const container = root.current?.getBoundingClientRect();
    if (!line || !container) {
      setPosition(null);
      return;
    }
    const size = coarse ? 32 : 24;
    const width = coarse ? 34 : HANDLE_WIDTH;
    // Inside the root's coordinates; on narrow screens keep it on the screen.
    const left = Math.max(line.left - width - 4, 2) - container.left;
    setPosition({ top: line.top - container.top + (line.height - size) / 2, left });
  }, [block, editor, coarse, root]);

  useLayoutEffect(() => {
    place();
    if (!block) return undefined;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // Layout changes (typing above, images loading) move the block.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (root.current) observer?.observe(root.current);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [block, place, root]);

  const openMenu = (via: 'handle' | 'keyboard') => {
    if (!block) return;
    const node = editor.state.doc.nodeAt(block.pos);
    if (!node) return;
    if (NodeSelection.isSelectable(node))
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, block.pos)),
      );
    controller.blockMenu.set({ pos: block.pos, node, via });
  };
  const closeMenu = () => controller.blockMenu.set(null);

  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !block) return;
    // Handled here: a press is a drag or a click, never Radix's open-on-press.
    event.preventDefault();
    if (coarse || event.pointerType === 'touch') {
      openMenu('handle');
      return;
    }
    const current = editor.state.doc.nodeAt(block.pos);
    if (!current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startBlockDrag(
      editor.view,
      controller,
      { pos: block.pos, node: current },
      event.nativeEvent,
      () => openMenu('handle'),
    );
  };

  if (!block || !position || readOnly || editor.isDestroyed) return null;
  const buttonClass = cn(
    'duration-fast flex items-center justify-center rounded-[5px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
    coarse ? 'size-8 bg-surface/90 shadow-subtle' : 'h-6 w-[22px]',
  );
  return (
    <div
      className={cn(
        'tess-block-handle absolute z-10 flex items-center gap-0.5',
        dragging && 'pointer-events-none opacity-0',
      )}
      style={{ top: position.top, left: position.left }}
      data-block-type={block.node.type.name}
    >
      {!coarse ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('addBlockBelow')}
          title={t('addBlockBelow')}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const current = editor.state.doc.nodeAt(block.pos);
            if (current) insertParagraphAfter(editor, { pos: block.pos, node: current });
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <DropdownMenu
        open={!!menu}
        modal={false}
        onOpenChange={(open) => {
          if (open) openMenu('keyboard');
          else closeMenu();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(buttonClass, 'cursor-grab touch-none active:cursor-grabbing')}
            aria-label={t('blockActions')}
            title={t('blockHandle')}
            data-drag-handle=""
            onPointerDown={onGripPointerDown}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        {menu ? (
          <BlockMenuContent
            controller={controller}
            editor={editor}
            block={{ pos: menu.pos, node: menu.node }}
            onDone={closeMenu}
          />
        ) : null}
      </DropdownMenu>
    </div>
  );
}
