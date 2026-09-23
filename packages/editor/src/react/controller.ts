import type { AppContext, ToastOptions } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { SuggestionMenuState } from '../menus/types';
import { createStore, type Store } from './store';

/** What an anchored popover is for. The React layer renders the matching UI. */
export type PopoverRequest =
  | { kind: 'callout'; pos: number }
  | { kind: 'codeLanguage'; pos: number }
  | { kind: 'imageAlt'; pos: number }
  | { kind: 'image'; insertAt: number }
  | { kind: 'table'; insertAt: number }
  | { kind: 'webEmbed'; insertAt: number; display: 'embed' | 'bookmark' }
  | { kind: 'urlPaste'; from: number; to: number; url: string }
  | { kind: 'link'; from: number; to: number; href: string | null };

/** An open popover: the request plus the element (or rectangle) it is anchored to. */
export interface PopoverState {
  request: PopoverRequest;
  anchor: HTMLElement | DOMRect;
  /** Where focus goes when the popover closes (defaults to the editor). */
  returnFocus?: HTMLElement | null;
}

/** A link hover preview. */
export interface LinkPreviewState {
  pageId: string;
  anchor: HTMLElement;
}

/** The block the handle is next to (hovered, or the caret's block on touch screens). */
export interface HandleState {
  pos: number;
  node: PMNode;
}

/** The open block menu: the block it acts on, and how it was opened. */
export interface BlockMenuState {
  pos: number;
  node: PMNode;
  /** Opened from the keyboard (focus the first item) or the handle. */
  via: 'handle' | 'keyboard';
}

/**
 * Shared, non-React state of one editor instance: the app context, the page, and the stores that
 * ProseMirror plugins and DOM node views use to open React UI (popovers, previews). Document
 * content never goes here; it lives in Yjs and ProseMirror.
 */
export interface EditorController {
  readonly ctx: AppContext;
  readonly pageId: string;
  editor: Editor | null;
  readonly popover: Store<PopoverState | null>;
  readonly linkPreview: Store<LinkPreviewState | null>;
  /** The open suggestion menu (slash commands, page links), if any. */
  readonly menu: Store<SuggestionMenuState | null>;
  /** True while the page is read-only (trashed). React node views re-render when it changes. */
  readonly readOnly: Store<boolean>;
  /** The block next to the handle, or null when the handle is hidden. */
  readonly handle: Store<HandleState | null>;
  /** The open block menu, if any. */
  readonly blockMenu: Store<BlockMenuState | null>;
  /** True while a block is being dragged. */
  readonly dragging: Store<boolean>;
  openPopover(state: PopoverState): void;
  closePopover(options?: { focusEditor?: boolean }): void;
  /** Shows the hover preview of a page link after a short delay. */
  requestLinkPreview(pageId: string, anchor: HTMLElement, options?: { immediate?: boolean }): void;
  /** Hides the preview after a grace period (so the pointer can move into the card). */
  releaseLinkPreview(options?: { immediate?: boolean }): void;
  /** Keeps the preview open (the pointer is over the card). */
  holdLinkPreview(): void;
  toast(options: ToastOptions | string): void;
  isEditable(): boolean;
}

/** Creates the controller of one editor instance. */
export function createEditorController(ctx: AppContext, pageId: string): EditorController {
  const popover = createStore<PopoverState | null>(null);
  const linkPreview = createStore<LinkPreviewState | null>(null);
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const controller: EditorController = {
    ctx,
    pageId,
    editor: null,
    popover,
    linkPreview,
    readOnly: createStore(false),
    menu: createStore<SuggestionMenuState | null>(null),
    handle: createStore<HandleState | null>(null),
    blockMenu: createStore<BlockMenuState | null>(null),
    dragging: createStore(false),
    openPopover(state) {
      linkPreview.set(null);
      popover.set(state);
    },
    closePopover({ focusEditor = true } = {}) {
      const current = popover.get();
      if (!current) return;
      popover.set(null);
      if (!focusEditor) return;
      const target = current.returnFocus;
      if (target && target.isConnected) target.focus();
      else if (controller.editor && !controller.editor.isDestroyed)
        controller.editor.commands.focus();
    },
    requestLinkPreview(pageId, anchor, { immediate = false } = {}) {
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      if (popover.get()) return;
      const current = linkPreview.get();
      if (current && current.anchor === anchor) return;
      const show = () => linkPreview.set({ pageId, anchor });
      if (immediate || current) show();
      else showTimer = setTimeout(show, 450);
    },
    releaseLinkPreview({ immediate = false } = {}) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (immediate) linkPreview.set(null);
      else hideTimer = setTimeout(() => linkPreview.set(null), 220);
    },
    holdLinkPreview() {
      clearTimeout(hideTimer);
    },
    toast(options) {
      ctx.toast(options);
    },
    isEditable: () =>
      !controller.readOnly.get() && !!controller.editor && controller.editor.isEditable,
  };
  return controller;
}
