import {
  BLOCK_COLORS,
  newBlockId,
  TEXT_COLORS,
  type BlockColor,
  type IconComponent,
} from '@tessera/core';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  cn,
} from '@tessera/ui';
import type { Editor } from '@tiptap/core';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Palette,
  Quote,
  Repeat2,
  SquareCode,
  Trash2,
  Type,
} from 'lucide-react';
import {
  canTurnInto,
  deleteBlocks,
  duplicateBlock,
  moveBlock,
  setBlockColor,
  turnInto,
  turnIntoTypeOf,
  TURN_INTO_TYPES,
  type BlockRef,
  type TurnIntoType,
} from '../actions/blocks';
import { nodesToDocJSON, toMarkdown } from '../clipboard/markdown';
import { t } from '../i18n';
import { copyText } from '../node-views/code-block';
import type { EditorController } from '../react/controller';
import { COLOR_TYPES } from '../schema/attributes';

/** Label and icon of each block type (Turn into, the slash menu uses the same icons). */
export const BLOCK_TYPE_META: Record<TurnIntoType, { label: () => string; icon: IconComponent }> = {
  paragraph: { label: () => t('blockText'), icon: Type },
  heading1: { label: () => t('blockHeading1'), icon: Heading1 },
  heading2: { label: () => t('blockHeading2'), icon: Heading2 },
  heading3: { label: () => t('blockHeading3'), icon: Heading3 },
  bulletList: { label: () => t('blockBulletList'), icon: List },
  orderedList: { label: () => t('blockOrderedList'), icon: ListOrdered },
  taskList: { label: () => t('blockTaskList'), icon: ListTodo },
  toggle: { label: () => t('blockToggle'), icon: ChevronRight },
  blockquote: { label: () => t('blockQuote'), icon: Quote },
  callout: { label: () => t('blockCallout'), icon: Lightbulb },
  codeBlock: { label: () => t('blockCode'), icon: SquareCode },
};

const COLOR_TYPE_SET = new Set<string>(COLOR_TYPES);
const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

function colorName(color: string): string {
  return t(`color_${color}` as 'color_gray');
}

/** Literal class names, so Tailwind generates them. */
const SWATCH_TEXT: Record<string, string> = {
  gray: 'text-tag-gray-fg',
  brown: 'text-tag-brown-fg',
  orange: 'text-tag-orange-fg',
  yellow: 'text-tag-yellow-fg',
  green: 'text-tag-green-fg',
  blue: 'text-tag-blue-fg',
  purple: 'text-tag-purple-fg',
  pink: 'text-tag-pink-fg',
  red: 'text-tag-red-fg',
};
const SWATCH_BACKGROUND: Record<string, string> = {
  gray: 'bg-tag-gray-bg',
  brown: 'bg-tag-brown-bg',
  orange: 'bg-tag-orange-bg',
  yellow: 'bg-tag-yellow-bg',
  green: 'bg-tag-green-bg',
  blue: 'bg-tag-blue-bg',
  purple: 'bg-tag-purple-bg',
  pink: 'bg-tag-pink-bg',
  red: 'bg-tag-red-bg',
};

function Swatch({ color }: { color: BlockColor | null }) {
  const background = color?.endsWith('-background') ?? false;
  const base = color ? color.replace('-background', '') : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 items-center justify-center rounded-[4px] border border-border text-xs font-semibold text-fg',
        base && background && SWATCH_BACKGROUND[base],
        base && !background && SWATCH_TEXT[base],
      )}
    >
      A
    </span>
  );
}

/** Copies a block as markdown (through the workspace's codec). */
async function copyBlockMarkdown(controller: EditorController, block: BlockRef, editor: Editor) {
  const parent = editor.state.doc.resolve(block.pos).parent;
  const markdown = toMarkdown(controller.ctx, nodesToDocJSON([block.node], parent.type.name));
  const ok = await copyText(markdown);
  controller.toast({
    title: ok ? t('copied') : t('copyFailed'),
    variant: ok ? 'success' : 'error',
  });
}

/** Copies a link to the block (giving it an ID first when it has none). */
async function copyBlockLink(controller: EditorController, block: BlockRef, editor: Editor) {
  let blockId = typeof block.node.attrs.blockId === 'string' ? block.node.attrs.blockId : null;
  if (!blockId) {
    if (!('blockId' in block.node.attrs)) return;
    blockId = newBlockId();
    editor.view.dispatch(editor.state.tr.setNodeAttribute(block.pos, 'blockId', blockId));
  }
  const url = `${window.location.origin}/p/${encodeURIComponent(controller.pageId)}#block-${blockId}`;
  const ok = await copyText(url);
  controller.toast({
    title: ok ? t('copied') : t('copyFailed'),
    variant: ok ? 'success' : 'error',
  });
}

/**
 * The block menu (from the handle, or the context-menu key on a selected block): turn into,
 * color, duplicate, copy as markdown, copy link, move, delete.
 */
export function BlockMenuContent({
  controller,
  editor,
  block,
  onDone,
}: {
  controller: EditorController;
  editor: Editor;
  block: BlockRef;
  onDone: () => void;
}) {
  const parent = editor.state.doc.resolve(block.pos).parent;
  const currentType = turnIntoTypeOf(block.node, parent);
  const colorable = COLOR_TYPE_SET.has(block.node.type.name);
  const currentColor = (block.node.attrs.color as BlockColor | null | undefined) ?? null;
  const hasId = 'blockId' in block.node.attrs;
  const run = (action: () => void) => () => {
    onDone();
    action();
    if (!editor.isDestroyed) editor.view.focus();
  };
  const textColors: Array<BlockColor | null> = [null, ...TEXT_COLORS];
  const backgrounds: Array<BlockColor | null> = [
    null,
    ...BLOCK_COLORS.filter((color) => color.endsWith('-background')),
  ];

  return (
    <DropdownMenuContent
      align="start"
      side="bottom"
      className="w-60"
      aria-label={t('blockActions')}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <DropdownMenuSub>
        <DropdownMenuSubTrigger icon={<Repeat2 />}>{t('turnInto')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-[70vh] w-56 overflow-y-auto">
          {TURN_INTO_TYPES.map((type) => {
            const meta = BLOCK_TYPE_META[type];
            const Icon = meta.icon;
            const enabled = type !== currentType && canTurnInto(editor, block.pos, type);
            return (
              <DropdownMenuItem
                key={type}
                icon={<Icon />}
                disabled={!enabled && type !== currentType}
                onSelect={run(() => {
                  if (type !== currentType) turnInto(editor, block.pos, type);
                })}
              >
                <span className="flex items-center justify-between gap-2">
                  {meta.label()}
                  {type === currentType ? (
                    <Check className="text-accent-text" aria-hidden="true" />
                  ) : null}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger icon={<Palette />} disabled={!colorable}>
          {t('color')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-[70vh] w-56 overflow-y-auto">
          <DropdownMenuLabel>{t('textColor')}</DropdownMenuLabel>
          {textColors.map((color) => (
            <DropdownMenuItem
              key={color ?? 'default'}
              icon={<Swatch color={color} />}
              onSelect={run(() => setBlockColor(editor, block, color))}
            >
              <span className="flex items-center justify-between gap-2">
                {color ? colorName(color) : t('colorDefault')}
                {currentColor === color ? <Check aria-hidden="true" /> : null}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('backgroundColor')}</DropdownMenuLabel>
          {backgrounds.map((color) => (
            <DropdownMenuItem
              key={color ?? 'default-background'}
              icon={<Swatch color={color} />}
              onSelect={run(() => setBlockColor(editor, block, color))}
            >
              <span className="flex items-center justify-between gap-2">
                {color
                  ? t('colorBackgroundName', { color: colorName(color.replace('-background', '')) })
                  : t('colorDefaultBackground')}
                {currentColor === color && color ? <Check aria-hidden="true" /> : null}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        icon={<Copy />}
        shortcut={[MOD, 'D']}
        onSelect={run(() => duplicateBlock(editor, block))}
      >
        {t('duplicate')}
      </DropdownMenuItem>
      <DropdownMenuItem
        icon={<FileCode />}
        onSelect={run(() => void copyBlockMarkdown(controller, block, editor))}
      >
        {t('copyMarkdown')}
      </DropdownMenuItem>
      {hasId ? (
        <DropdownMenuItem
          icon={<Link2 />}
          onSelect={run(() => void copyBlockLink(controller, block, editor))}
        >
          {t('copyBlockLink')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        icon={<ArrowUp />}
        shortcut={[MOD, 'Shift', '↑']}
        onSelect={run(() => moveBlock(editor, block, 'up'))}
      >
        {t('moveUp')}
      </DropdownMenuItem>
      <DropdownMenuItem
        icon={<ArrowDown />}
        shortcut={[MOD, 'Shift', '↓']}
        onSelect={run(() => moveBlock(editor, block, 'down'))}
      >
        {t('moveDown')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        icon={<Trash2 />}
        shortcut={['Del']}
        destructive
        onSelect={run(() => deleteBlocks(editor, [block]))}
      >
        {t('delete')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
