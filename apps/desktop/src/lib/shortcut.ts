/**
 * Global shortcuts use Tauri's accelerator syntax (`CommandOrControl+Shift+Space`). These helpers
 * record one from a key event and format one for display.
 */

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backquote: 'Backquote',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
};

const LABELS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * The accelerator for a key event, or null while only modifiers are held, or when the combination
 * has no modifier at all (a global shortcut on a bare key would swallow typing everywhere).
 */
export function acceleratorFromEvent(event: KeyLike, isApple: boolean): string | null {
  let key: string | undefined;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (letter) key = letter;
  else if (digit) key = digit;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else key = CODE_KEYS[event.code];
  if (!key) return null;
  const primary = isApple ? event.metaKey : event.ctrlKey;
  const secondary = isApple ? event.ctrlKey : event.metaKey;
  const parts: string[] = [];
  if (primary) parts.push('CommandOrControl');
  if (secondary) parts.push(isApple ? 'Control' : 'Super');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const hasModifier = primary || secondary || event.altKey;
  if (!hasModifier) return null;
  parts.push(key);
  return parts.join('+');
}

/** Key labels for an accelerator, for `<Kbd>`s (`['⌘', '⇧', 'Space']` on a Mac). */
export function formatAccelerator(accelerator: string, isApple: boolean): string[] {
  return accelerator.split('+').map((part) => {
    const lower = part.toLowerCase();
    if (['commandorcontrol', 'cmdorctrl', 'commandorctrl', 'cmdorcontrol'].includes(lower))
      return isApple ? '⌘' : 'Ctrl';
    if (['command', 'cmd', 'super', 'meta'].includes(lower)) return isApple ? '⌘' : 'Win';
    if (['control', 'ctrl'].includes(lower)) return isApple ? '⌃' : 'Ctrl';
    if (['alt', 'option'].includes(lower)) return isApple ? '⌥' : 'Alt';
    if (lower === 'shift') return isApple ? '⇧' : 'Shift';
    return LABELS[part] ?? part;
  });
}
