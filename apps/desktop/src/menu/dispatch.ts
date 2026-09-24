import { COMMANDS, matchesShortcut, type AppContext, type ShortcutEvent } from '@tessera/core';
import { MENU_ONLY } from '../constants';

/**
 * Native menu clicks and accelerators arrive as `desktop://menu` events. Whether a menu
 * accelerator also reaches the page differs by OS (macOS menus swallow the key; WebView2 on
 * Windows sees it first), so the page records recent keydowns and a menu event whose shortcut the
 * page just saw is skipped: the page's own shortcut handling has already run it.
 */

interface RecordedKey extends ShortcutEvent {
  at: number;
}

const RECENT_MS = 500;
/** Menu events can arrive a moment before the keydown that caused them. */
const SETTLE_MS = 40;

export class MenuDispatcher {
  private recent: RecordedKey[] = [];
  private shortcuts = new Map<string, string>();
  private readonly offKeys: () => void;

  constructor(
    private readonly getContext: () => AppContext | null,
    private readonly handlers: {
      /** Menu items that are not commands, or that must work without an open workspace. */
      fallback?: (id: string) => boolean | Promise<boolean>;
      isApple: boolean;
      now?: () => number;
    },
    target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  ) {
    const record = (event: Event) => {
      const key = event as KeyboardEvent;
      const at = this.now();
      this.recent = [
        ...this.recent.filter((entry) => at - entry.at < RECENT_MS),
        {
          key: key.key,
          code: key.code,
          ctrlKey: key.ctrlKey,
          metaKey: key.metaKey,
          altKey: key.altKey,
          shiftKey: key.shiftKey,
          at,
        },
      ];
    };
    target.addEventListener('keydown', record, true);
    this.offKeys = () => target.removeEventListener('keydown', record, true);
  }

  private now(): number {
    return this.handlers.now?.() ?? Date.now();
  }

  setShortcuts(shortcuts: Map<string, string>): void {
    this.shortcuts = shortcuts;
  }

  /** True when the page itself just received the item's shortcut. */
  sawShortcut(id: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) return false;
    const now = this.now();
    return this.recent.some(
      (entry) =>
        now - entry.at < RECENT_MS && matchesShortcut(entry, shortcut, this.handlers.isApple),
    );
  }

  async dispatch(id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    if (this.sawShortcut(id)) return;
    if (id === MENU_ONLY.undo || id === MENU_ONLY.redo) {
      editHistory(id === MENU_ONLY.undo ? 'undo' : 'redo', this.handlers.isApple);
      return;
    }
    const commandId = id === 'tray.newPage' ? COMMANDS.newPage : id;
    const ctx = this.getContext();
    if (ctx?.commands.has(commandId)) {
      await ctx.commands.execute(commandId, { source: 'menu' });
      return;
    }
    await this.handlers.fallback?.(id);
  }

  dispose(): void {
    this.offKeys();
  }
}

/**
 * Undo or redo in whatever has focus. The editor handles its own keymap (Yjs-aware undo), so it
 * receives the shortcut as a key event; plain text fields use the browser's native history.
 */
export function editHistory(
  kind: 'undo' | 'redo',
  isApple: boolean,
  doc: Document = document,
): void {
  const target = doc.activeElement;
  const editable =
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('[contenteditable="true"]') !== null);
  if (editable) {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: !isApple,
        metaKey: isApple,
        shiftKey: kind === 'redo',
        bubbles: true,
        cancelable: true,
      }),
    );
    return;
  }
  // `execCommand` is deprecated but remains the only way to drive a field's native undo stack.
  if (typeof doc.execCommand === 'function') doc.execCommand(kind);
}
