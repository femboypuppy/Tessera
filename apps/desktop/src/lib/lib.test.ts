import { describe, expect, it } from 'vitest';
import { displayPath, joinPath, parentPath, revealLabel } from './paths';
import { acceleratorFromEvent, formatAccelerator } from './shortcut';
import { createStore } from './store';

const key = (
  code: string,
  mods: Partial<Record<'ctrl' | 'meta' | 'alt' | 'shift', boolean>> = {},
) => ({
  code,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe('paths', () => {
  it('shows home-relative paths and joins with the right separator', () => {
    expect(displayPath('/home/ada/Tessera/Apollo', '/home/ada')).toBe('~/Tessera/Apollo');
    expect(displayPath('C:\\Users\\ada\\Tessera', 'C:\\Users\\ada')).toBe('~\\Tessera');
    expect(displayPath('/home/adam/x', '/home/ada')).toBe('/home/adam/x');
    expect(joinPath('C:\\Users\\ada\\Tessera\\', 'Notes')).toBe('C:\\Users\\ada\\Tessera\\Notes');
    expect(joinPath('/home/ada/Tessera', 'Notes')).toBe('/home/ada/Tessera/Notes');
    expect(parentPath('/home/ada/Tessera/')).toBe('/home/ada');
    expect(revealLabel('mac')).toBe('Reveal in Finder');
    expect(revealLabel('windows')).toBe('Show in Explorer');
    expect(revealLabel('linux')).toBe('Show in file manager');
  });
});

describe('global shortcut recording', () => {
  it('records portable accelerators and requires a modifier', () => {
    expect(acceleratorFromEvent(key('Space', { ctrl: true, shift: true }), false)).toBe(
      'CommandOrControl+Shift+Space',
    );
    expect(acceleratorFromEvent(key('Space', { meta: true, shift: true }), true)).toBe(
      'CommandOrControl+Shift+Space',
    );
    expect(acceleratorFromEvent(key('KeyN', { alt: true }), false)).toBe('Alt+N');
    expect(acceleratorFromEvent(key('Digit1', { ctrl: true }), true)).toBe('Control+1');
    expect(acceleratorFromEvent(key('KeyN'), false)).toBeNull();
    expect(acceleratorFromEvent(key('KeyN', { shift: true }), false)).toBeNull();
    expect(acceleratorFromEvent(key('ShiftLeft', { shift: true, ctrl: true }), false)).toBeNull();
  });

  it('formats accelerators per platform', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Space', true)).toEqual(['⌘', '⇧', 'Space']);
    expect(formatAccelerator('CommandOrControl+Shift+Space', false)).toEqual([
      'Ctrl',
      'Shift',
      'Space',
    ]);
    expect(formatAccelerator('Alt+Backslash', false)).toEqual(['Alt', '\\']);
  });
});

describe('store', () => {
  it('notifies on change only', () => {
    const store = createStore(1);
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    store.set(1);
    store.set((value) => value + 1);
    off();
    store.set(5);
    expect(store.get()).toBe(5);
    expect(calls).toBe(1);
  });
});
