/**
 * Keyboard shortcuts are strings like `Mod+Shift+L`: modifiers (`Mod`, `Ctrl`, `Alt`, `Shift`,
 * `Meta`) then one key, joined by `+`. `Mod` is ⌘ on Apple platforms and Ctrl elsewhere. Keys are
 * single characters (`K`, `1`, `\`, `/`, `?`, `,`) or names (`Enter`, `Escape`, `Backspace`,
 * `Delete`, `Tab`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`,
 * `PageUp`, `PageDown`, `F1`–`F12`). Use `Plus` for the `+` key.
 */

const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  tab: 'Tab',
  space: 'Space',
  ' ': 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: 'Plus',
};

/** A parsed shortcut. */
export interface ParsedShortcut {
  modifiers: ReadonlySet<Modifier>;
  key: string;
}

function normalizeKey(key: string): string {
  const named = NAMED_KEYS[key.toLowerCase()];
  if (named) return named;
  if (/^f([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Parses a shortcut string. Throws for malformed shortcuts.
 *
 * @example
 * parseShortcut('mod+shift+l'); // { modifiers: Set { 'Mod', 'Shift' }, key: 'L' }
 */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map((part) => part.trim());
  const key = parts.pop();
  if (!key) throw new TypeError(`Invalid shortcut "${shortcut}"`);
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const modifier = MODIFIERS.find(
      (m) =>
        m.toLowerCase() === part.toLowerCase() ||
        (m === 'Ctrl' && part.toLowerCase() === 'control'),
    );
    if (!modifier) throw new TypeError(`Unknown modifier "${part}" in "${shortcut}"`);
    modifiers.add(modifier);
  }
  return { modifiers, key: normalizeKey(key) };
}

/** Canonical form of a shortcut (`Mod+Alt+Shift+K`), for comparisons and conflict detection. */
export function normalizeShortcut(shortcut: string): string {
  const { modifiers, key } = parseShortcut(shortcut);
  return [...MODIFIERS.filter((m) => modifiers.has(m)), key].join('+');
}

/** The keyboard event fields shortcut matching needs. */
export type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

function eventKeys(event: ShortcutEvent): string[] {
  const keys = [normalizeKey(event.key === '+' ? 'Plus' : event.key)];
  // Layout-independent fallback for letters and digits (Alt/Option combos, non-Latin layouts).
  const code = /^Key([A-Z])$/.exec(event.code)?.[1] ?? /^Digit([0-9])$/.exec(event.code)?.[1];
  if (code) keys.push(code);
  return keys;
}

/**
 * True when a keyboard event matches `shortcut` on this platform. Shift is ignored for symbol keys
 * that need it on some layouts (`?`, `+`), unless the shortcut names Shift explicitly.
 *
 * @example
 * if (matchesShortcut(event, 'Mod+K', platform.isApple)) openPalette();
 */
export function matchesShortcut(event: ShortcutEvent, shortcut: string, isApple: boolean): boolean {
  let parsed: ParsedShortcut;
  try {
    parsed = parseShortcut(shortcut);
  } catch {
    return false;
  }
  const { modifiers, key } = parsed;
  const wantCtrl = modifiers.has('Ctrl') || (modifiers.has('Mod') && !isApple);
  const wantMeta = modifiers.has('Meta') || (modifiers.has('Mod') && isApple);
  if (
    event.ctrlKey !== wantCtrl ||
    event.metaKey !== wantMeta ||
    event.altKey !== modifiers.has('Alt')
  )
    return false;
  const isSymbol = key.length === 1 && !/[A-Z0-9]/.test(key);
  if (!(isSymbol && !modifiers.has('Shift')) && event.shiftKey !== modifiers.has('Shift'))
    return false;
  return eventKeys(event).includes(key);
}

const APPLE_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Meta: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
};
const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  Space: 'Space',
  Plus: '+',
};

/**
 * The key labels to display for a shortcut (render each in a `<Kbd>`).
 *
 * @example
 * formatShortcut('Mod+Shift+L', true); // ['⌘', '⇧', 'L']
 * formatShortcut('Mod+Shift+L', false); // ['Ctrl', 'Shift', 'L']
 */
export function formatShortcut(shortcut: string, isApple: boolean): string[] {
  const { modifiers, key } = parseShortcut(shortcut);
  const labels = MODIFIERS.filter((m) => modifiers.has(m)).map((m) => {
    if (isApple) return APPLE_SYMBOLS[m] ?? m;
    return m === 'Mod' ? 'Ctrl' : m === 'Meta' ? 'Win' : m;
  });
  labels.push(KEY_LABELS[key] ?? key);
  return labels;
}

/** True when the event target is a text field, editable element or the editor. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return (
    element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !==
    null
  );
}
