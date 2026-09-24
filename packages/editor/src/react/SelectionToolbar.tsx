import { TEXT_COLORS, type HighlightColor } from '@tessera/core';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@tessera/ui';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Highlighter,
  Italic,
  Link2,
  Strikethrough,
  Underline,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { blockAt, canTurnInto, turnInto, turnIntoTypeOf, TURN_INTO_TYPES } from '../actions/blocks';
import { BLOCK_TYPE_META } from '../handle/BlockMenu';
import { t } from '../i18n';
import type { EditorController } from './controller';
import { useFloatingPosition } from './floating';
import { useStore } from './store';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';
const SHIFT = MAC ? '⇧' : 'Shift+';

const HIGHLIGHT_SWATCH: Record<HighlightColor, string> = {
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

interface ToolbarState {
  from: number;
  to: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
  highlight: HighlightColor | 'default' | null;
  blockPos: number | null;
  blockType: string | null;
}

function readToolbarState(editor: Editor): ToolbarState | null {
  const { selection } = editor.state;
  if (!editor.isEditable || !(selection instanceof TextSelection) || selection.empty) return null;
  if (selection.$from.parent.type.spec.code) return null;
  if (!editor.state.doc.textBetween(selection.from, selection.to).trim()) return null;
  const block = blockAt(selection.$from);
  const parent = block ? editor.state.doc.resolve(block.pos).parent : null;
  const highlight = editor.isActive('highlight')
    ? ((editor.getAttributes('highlight').color as HighlightColor | null) ?? 'default')
    : null;
  const href = editor.getAttributes('link').href;
  return {
    from: selection.from,
    to: selection.to,
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    link: typeof href === 'string' ? href : null,
    highlight,
    blockPos: block?.pos ?? null,
    blockType: block ? turnIntoTypeOf(block.node, parent) : null,
  };
}

function ToolbarButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-toolbar-item=""
      tabIndex={-1}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        'duration-fast flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none [&_svg]:size-4',
        active && 'bg-accent-subtle text-accent-text hover:bg-accent-subtle hover:text-accent-text',
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The formatting toolbar over selected text: turn into, bold, italic, underline, strikethrough,
 * inline code, link and highlight. Alt+F10 moves focus into it, arrow keys move between buttons
 * and Escape returns to the text. Fits a phone screen.
 */
export function SelectionToolbar({
  controller,
  editor,
}: {
  controller: EditorController;
  editor: Editor;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => readToolbarState(current),
  });
  const readOnly = useStore(controller.readOnly);
  const suggestionOpen = useStore(controller.menu, (menu) => menu !== null);
  const popoverOpen = useStore(controller.popover, (popover) => popover !== null);
  const blockMenuOpen = useStore(controller.blockMenu, (menu) => menu !== null);
  const dragging = useStore(controller.dragging);
  const [pointerDown, setPointerDown] = useState(false);
  const [focused, setFocused] = useState(() => editor.isFocused);
  const [menuOpen, setMenuOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);

  // Hidden while the mouse is still selecting, and when the editor loses focus to elsewhere.
  useEffect(() => {
    const dom = editor.view.dom;
    const down = () => setPointerDown(true);
    const up = () => setPointerDown(false);
    const focus = () => setFocused(true);
    const blur = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && panel.current?.contains(next)) return;
      setFocused(false);
    };
    const openWithKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.altKey && event.key === 'F10') {
        const first = panel.current?.querySelector<HTMLElement>('[data-toolbar-item]');
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    dom.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    dom.addEventListener('focus', focus);
    dom.addEventListener('blur', blur);
    dom.addEventListener('keydown', openWithKeyboard);
    return () => {
      dom.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      dom.removeEventListener('focus', focus);
      dom.removeEventListener('blur', blur);
      dom.removeEventListener('keydown', openWithKeyboard);
    };
  }, [editor]);

  const from = state?.from ?? 0;
  const to = state?.to ?? 0;
  const getRect = useCallback(() => posToDOMRect(editor.view, from, to), [editor, from, to]);
  const visible =
    !!state &&
    !readOnly &&
    (focused || menuOpen) &&
    !pointerDown &&
    !suggestionOpen &&
    !popoverOpen &&
    !blockMenuOpen &&
    !dragging;
  const position = useFloatingPosition(
    panel,
    visible ? getRect : null,
    { gap: 8, align: 'center', prefer: 'above' },
    `${from}:${to}`,
  );

  if (!visible || !state) return null;

  const chain = () => editor.chain().focus();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next =
        items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
      next?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === 'Escape' && !menuOpen) {
      event.preventDefault();
      editor.commands.focus();
    }
  };
  const currentType = state.blockType as (typeof TURN_INTO_TYPES)[number] | null;
  const TypeIcon = currentType ? BLOCK_TYPE_META[currentType].icon : null;

  return createPortal(
    <div
      ref={panel}
      role="toolbar"
      aria-label={t('formatting')}
      aria-orientation="horizontal"
      className={cn(
        'tess-selection-toolbar fixed z-[var(--tess-z-popover)] flex max-w-[calc(100vw-16px)] items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface-raised p-1 shadow-popover',
        position ? 'visible animate-pop-in' : 'invisible',
      )}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
      onKeyDown={onKeyDown}
    >
      {currentType && state.blockPos !== null ? (
        <DropdownMenu modal={false} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-toolbar-item=""
              tabIndex={-1}
              aria-label={`${t('turnInto')}: ${BLOCK_TYPE_META[currentType].label()}`}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-ui whitespace-nowrap text-fg-muted hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              onMouseDown={(event) => event.preventDefault()}
            >
              {TypeIcon ? <TypeIcon className="size-4" aria-hidden="true" /> : null}
              <span className="hidden sm:inline">{BLOCK_TYPE_META[currentType].label()}</span>
              <ChevronDown className="size-3" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-52"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {TURN_INTO_TYPES.map((type) => {
              const meta = BLOCK_TYPE_META[type];
              const Icon = meta.icon;
              const pos = state.blockPos ?? 0;
              return (
                <DropdownMenuItem
                  key={type}
                  icon={<Icon />}
                  disabled={type !== currentType && !canTurnInto(editor, pos, type)}
                  onSelect={() => {
                    if (type !== currentType) turnInto(editor, pos, type);
                    editor.commands.focus();
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    {meta.label()}
                    {type === currentType ? <Check aria-hidden="true" /> : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <span className="mx-0.5 h-5 w-px flex-none bg-border" aria-hidden="true" />
      <ToolbarButton
        label={t('bold')}
        shortcut={`${MOD}B`}
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t('italic')}
        shortcut={`${MOD}I`}
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t('underline')}
        shortcut={`${MOD}U`}
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <Underline aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t('strike')}
        shortcut={`${MOD}${SHIFT}S`}
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t('inlineCode')}
        shortcut={`${MOD}E`}
        active={state.code}
        onClick={() => chain().toggleCode().run()}
      >
        <Code aria-hidden="true" />
      </ToolbarButton>
      <button
        ref={linkButton}
        type="button"
        data-toolbar-item=""
        tabIndex={-1}
        aria-label={state.link ? t('editLink') : t('link')}
        aria-pressed={!!state.link}
        title={t('link')}
        className={cn(
          'flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none [&_svg]:size-4',
          state.link && 'bg-accent-subtle text-accent-text',
        )}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          controller.openPopover({
            request: { kind: 'link', from: state.from, to: state.to, href: state.link },
            anchor: linkButton.current ?? getRect(),
          })
        }
      >
        <Link2 aria-hidden="true" />
      </button>
      <DropdownMenu modal={false} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-toolbar-item=""
            tabIndex={-1}
            aria-label={t('highlightColor')}
            title={t('highlight')}
            className={cn(
              'flex h-8 items-center gap-0.5 rounded-md px-1.5 text-fg-muted hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none [&_svg]:size-4',
              state.highlight && 'bg-accent-subtle text-accent-text',
            )}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Highlighter aria-hidden="true" />
            <ChevronDown className="!size-3" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem onSelect={() => chain().unsetHighlight().run()}>
            <span className="flex items-center justify-between gap-2">
              {t('noHighlight')}
              {!state.highlight ? <Check aria-hidden="true" /> : null}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<span className="size-4 rounded-sm bg-tag-yellow-bg" aria-hidden="true" />}
            onSelect={() => chain().unsetHighlight().setHighlight().run()}
          >
            <span className="flex items-center justify-between gap-2">
              {t('highlightDefault')}
              {state.highlight === 'default' ? <Check aria-hidden="true" /> : null}
            </span>
          </DropdownMenuItem>
          {TEXT_COLORS.filter((color) => color !== 'yellow').map((color) => (
            <DropdownMenuItem
              key={color}
              icon={
                <span
                  className={cn('size-4 rounded-sm', HIGHLIGHT_SWATCH[color])}
                  aria-hidden="true"
                />
              }
              onSelect={() => chain().setHighlight({ color }).run()}
            >
              <span className="flex items-center justify-between gap-2">
                {t(`color_${color}` as 'color_gray')}
                {state.highlight === color ? <Check aria-hidden="true" /> : null}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>,
    document.body,
  );
}
