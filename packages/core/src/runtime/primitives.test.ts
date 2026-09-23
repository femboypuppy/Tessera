// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBlockRendererRegistry } from './blocks';
import { COMMANDS, commandShortcuts, createCommandRegistry, type Command } from './commands';
import { createKeyedDebouncer } from './debounce';
import { createEventBus } from './events';
import {
  formatShortcut,
  isEditableTarget,
  matchesShortcut,
  normalizeShortcut,
  parseShortcut,
} from './keyboard';
import { LocalStorageSettingsStore, MemorySettingsStore, WorkspaceSettingsStore } from './settings';
import { detectPlatform } from './platform';
import { colorForId, USER_COLORS } from './user';
import type { AppContext } from './app-context';

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe('keyboard shortcuts', () => {
  it('parses, normalizes and formats', () => {
    expect(parseShortcut('mod+shift+l')).toEqual({
      modifiers: new Set(['Mod', 'Shift']),
      key: 'L',
    });
    expect(normalizeShortcut('shift+MOD+k')).toBe('Mod+Shift+K');
    expect(normalizeShortcut('Mod+\\')).toBe('Mod+\\');
    expect(normalizeShortcut('ctrl+esc')).toBe('Ctrl+Escape');
    expect(normalizeShortcut('Alt+Plus')).toBe('Alt+Plus');
    expect(() => parseShortcut('Hyper+K')).toThrow(TypeError);
    expect(formatShortcut('Mod+Shift+L', true)).toEqual(['⌘', '⇧', 'L']);
    expect(formatShortcut('Mod+Shift+L', false)).toEqual(['Ctrl', 'Shift', 'L']);
    expect(formatShortcut('Mod+ArrowUp', false)).toEqual(['Ctrl', '↑']);
  });

  it('matches events per platform', () => {
    expect(matchesShortcut(key({ key: 'k', metaKey: true }), 'Mod+K', true)).toBe(true);
    expect(matchesShortcut(key({ key: 'k', ctrlKey: true }), 'Mod+K', true)).toBe(false);
    expect(matchesShortcut(key({ key: 'k', ctrlKey: true }), 'Mod+K', false)).toBe(true);
    expect(
      matchesShortcut(key({ key: 'K', ctrlKey: true, shiftKey: true }), 'Mod+Shift+K', false),
    ).toBe(true);
    expect(matchesShortcut(key({ key: 'K', ctrlKey: true, shiftKey: true }), 'Mod+K', false)).toBe(
      false,
    );
    expect(matchesShortcut(key({ key: '\\', ctrlKey: true }), 'Mod+\\', false)).toBe(true);
    // `?` needs Shift on US layouts; the shortcut need not say so.
    expect(matchesShortcut(key({ key: '?', shiftKey: true }), '?', false)).toBe(true);
    // Option+N on macOS produces a dead key; the physical key still matches.
    expect(
      matchesShortcut(
        key({ key: 'Dead', code: 'KeyN', metaKey: true, altKey: true }),
        'Mod+Alt+N',
        true,
      ),
    ).toBe(true);
    expect(matchesShortcut(key({ key: 'л', code: 'KeyK', ctrlKey: true }), 'Mod+K', false)).toBe(
      true,
    );
    expect(matchesShortcut(key({ key: 'k' }), 'Nope+K', false)).toBe(false);
  });

  it('detects editable targets', () => {
    const input = document.createElement('input');
    const div = document.createElement('div');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('command registry', () => {
  const app = {} as AppContext;
  let pageId: string | null = 'page-1';
  const registry = () =>
    createCommandRegistry({ getContext: () => ({ app, pageId }), isApple: false });

  afterEach(() => vi.restoreAllMocks());

  it('registers, lists, filters by `when` and executes with context', async () => {
    const commands = registry();
    const run = vi.fn();
    const offs = commands.registerMany([
      { id: 'b.second', title: 'Beta', group: 'page', run },
      { id: 'a.first', title: 'Alpha', group: 'page', when: ({ pageId: id }) => id !== null, run },
      { id: 'hidden', title: 'Hidden', hidden: true, run },
    ]);
    expect(commands.list().map((c) => c.id)).toEqual(['hidden', 'a.first', 'b.second']);
    expect(commands.available().map((c) => c.id)).toEqual(['a.first', 'b.second']);
    expect(await commands.execute('a.first', { args: { x: 1 }, source: 'palette' })).toBe(true);
    expect(run).toHaveBeenCalledWith({ app, pageId: 'page-1', args: { x: 1 }, source: 'palette' });
    pageId = null;
    expect(await commands.execute('a.first')).toBe(false);
    expect(commands.available().map((c) => c.id)).toEqual(['b.second']);
    expect(await commands.execute('missing')).toBe(false);
    offs();
    expect(commands.list()).toEqual([]);
    pageId = 'page-1';
  });

  it('reports failing commands and resolves false', async () => {
    const onError = vi.fn();
    const commands = createCommandRegistry({
      getContext: () => ({ app, pageId }),
      isApple: false,
      onError,
    });
    commands.register({
      id: 'boom',
      title: 'Boom',
      run: () => {
        throw new Error('nope');
      },
    });
    expect(await commands.execute('boom')).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ id: 'boom' }),
    );
  });

  it('finds commands for keyboard events, respecting editable targets', () => {
    const commands = registry();
    const help: Command = { id: 'help', title: 'Help', shortcut: '?', run: vi.fn() };
    const newPage: Command = {
      id: COMMANDS.newPage,
      title: 'New page',
      shortcut: ['Mod+N', 'Mod+Alt+N'],
      run: vi.fn(),
    };
    commands.registerMany([help, newPage]);
    const input = document.createElement('input');
    expect(commands.findForEvent(key({ key: '?', shiftKey: true }))?.id).toBe('help');
    expect(
      commands.findForEvent({ ...key({ key: '?', shiftKey: true }), target: input }),
    ).toBeUndefined();
    expect(
      commands.findForEvent({ ...key({ key: 'n', ctrlKey: true, altKey: true }), target: input })
        ?.id,
    ).toBe(COMMANDS.newPage);
    expect(commands.findForEvent(key({ key: 'x' }))).toBeUndefined();
    expect(commandShortcuts(newPage)).toEqual(['Mod+N', 'Mod+Alt+N']);
  });

  it('warns about reserved and duplicate shortcuts and duplicate IDs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const commands = registry();
    commands.register({ id: 'mine', title: 'Mine', shortcut: 'Mod+K', run: vi.fn() });
    commands.register({ id: 'other', title: 'Other', shortcut: 'mod+k', run: vi.fn() });
    commands.register({ id: 'other', title: 'Other again', run: vi.fn() });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('reserved'),
      expect.stringContaining('reserved'),
      expect.stringContaining('share'),
      expect.stringContaining('registered twice'),
    ]);
    expect(commands.get('other')?.title).toBe('Other again');
  });

  it('notifies subscribers', () => {
    const commands = registry();
    const listener = vi.fn();
    const off = commands.subscribe(listener);
    const unregister = commands.register({ id: 'x', title: 'X', run: vi.fn() });
    unregister();
    unregister();
    off();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('event bus', () => {
  it('delivers typed events, supports once, isolates failing handlers', () => {
    const onError = vi.fn();
    const bus = createEventBus({ onError });
    const seen: string[] = [];
    const off = bus.on('page.renamed', ({ title }) => seen.push(title));
    bus.on('page.renamed', () => {
      throw new Error('bad handler');
    });
    bus.once('page.renamed', ({ title }) => seen.push(`once:${title}`));
    bus.emit('page.renamed', { pageId: 'p', title: 'A', previousTitle: '', local: true });
    bus.emit('page.renamed', { pageId: 'p', title: 'B', previousTitle: 'A', local: true });
    expect(seen).toEqual(['A', 'once:A', 'B']);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(bus.listenerCount('page.renamed')).toBe(2);
    off();
    bus.clear();
    expect(bus.listenerCount('page.renamed')).toBe(0);
  });
});

describe('block renderer registry', () => {
  const Component = () => null;

  it('resolves exact kinds before prefixes, and the longest prefix', () => {
    const blocks = createBlockRendererRegistry();
    const exact = {
      kind: 'database',
      component: Component,
      slashMenu: [{ id: 'db', title: 'Database', create: () => ({ kind: 'database' }) }],
    };
    const plugins = { kind: 'plugin:', component: Component };
    const mermaid = { kind: 'plugin:mermaid/', component: Component };
    const offExact = blocks.register(exact);
    blocks.register(plugins);
    blocks.register(mermaid);
    const offItems = blocks.registerSlashMenuItems([
      { id: 'mermaid', title: 'Mermaid', create: () => ({ kind: 'plugin:mermaid/diagram' }) },
    ]);
    expect(blocks.resolve('database')).toBe(exact);
    expect(blocks.resolve('plugin:mermaid/diagram')).toBe(mermaid);
    expect(blocks.resolve('plugin:other/x')).toBe(plugins);
    expect(blocks.resolve('web')).toBeUndefined();
    expect(blocks.slashMenuItems().map((item) => item.id)).toEqual(['db', 'mermaid']);
    offItems();
    offExact();
    expect(blocks.resolve('database')).toBeUndefined();
    expect(blocks.list()).toHaveLength(2);
    expect(() => blocks.register({ kind: '', component: Component })).toThrow(TypeError);
  });
});

describe('settings stores', () => {
  it('memory store gets, sets, deletes, lists and notifies', () => {
    const store = new MemorySettingsStore({ 'a.one': 1 });
    const changes: string[] = [];
    store.subscribe((changed) => changes.push(changed));
    store.set('a.two', { nested: true });
    store.set('a.one', undefined);
    expect(store.get('a.two')).toEqual({ nested: true });
    expect(store.keys('a.')).toEqual(['a.two']);
    expect(changes).toEqual(['a.two', 'a.one']);
    expect(() => store.set('bad', new Date() as unknown as string)).toThrow(TypeError);
  });

  it('localStorage store persists JSON, survives corrupt values and hears other tabs', () => {
    localStorage.clear();
    const store = new LocalStorageSettingsStore();
    store.set('shell.theme', 'dark');
    expect(localStorage.getItem('tessera:device:shell.theme')).toBe('"dark"');
    expect(new LocalStorageSettingsStore().get('shell.theme')).toBe('dark');
    localStorage.setItem('tessera:device:broken', '{not json');
    expect(store.get('broken')).toBeUndefined();
    expect(store.keys('shell.')).toEqual(['shell.theme']);
    const changes: string[] = [];
    store.subscribe((changed) => changes.push(changed));
    window.dispatchEvent(new StorageEvent('storage', { key: 'tessera:device:user.name' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(changes).toEqual(['user.name']);
    store.set('shell.theme', undefined);
    expect(localStorage.getItem('tessera:device:shell.theme')).toBeNull();
    store.dispose();
  });

  it('workspace store reads and writes the workspace doc', () => {
    const ws = new Y.Doc();
    const store = new WorkspaceSettingsStore(ws);
    const changes: string[] = [];
    const off = store.subscribe((changed) => changes.push(changed));
    store.set('backlinks.showFooter', true);
    expect(store.get('backlinks.showFooter')).toBe(true);
    expect(store.keys()).toEqual(['backlinks.showFooter']);
    off();
    expect(changes).toEqual(['backlinks.showFooter']);
  });
});

describe('keyed debouncer', () => {
  it('debounces per key, merges values, honours max wait, flushes and cancels', () => {
    vi.useFakeTimers();
    const calls: Array<[string, number]> = [];
    const debouncer = createKeyedDebouncer<number>((k, v) => calls.push([k, v]), {
      delayMs: 100,
      maxWaitMs: 250,
      merge: (a, b) => a + b,
    });
    debouncer.call('a', 1);
    vi.advanceTimersByTime(90);
    debouncer.call('a', 2);
    debouncer.call('b', 10);
    vi.advanceTimersByTime(99);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([
      ['a', 3],
      ['b', 10],
    ]);
    for (let i = 0; i < 5; i += 1) {
      debouncer.call('c', 1);
      vi.advanceTimersByTime(60);
    }
    expect(calls).toContainEqual(['c', 5]);
    debouncer.call('d', 1);
    debouncer.flush();
    expect(calls).toContainEqual(['d', 1]);
    debouncer.call('e', 1);
    expect(debouncer.pending()).toBe(1);
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(calls.some(([k]) => k === 'e')).toBe(false);
    const immediate = createKeyedDebouncer<number>((k, v) => calls.push([k, v]), {
      delayMs: 0,
      maxWaitMs: 0,
      merge: (a, b) => a + b,
    });
    immediate.call('now', 7);
    expect(calls).toContainEqual(['now', 7]);
    vi.useRealTimers();
  });
});

describe('platform and user helpers', () => {
  it('detects platforms and picks stable colors', () => {
    expect(
      detectPlatform({
        navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' },
        tauri: false,
      }),
    ).toMatchObject({ os: 'mac', isApple: true });
    expect(
      detectPlatform({
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        tauri: true,
      }),
    ).toMatchObject({ os: 'windows', isApple: false, isDesktopApp: true });
    expect(
      detectPlatform({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' } }),
    ).toMatchObject({ os: 'ios', isApple: true });
    expect(
      detectPlatform({
        navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
        matchMedia: () => ({ matches: true }),
      }),
    ).toMatchObject({ os: 'linux', isTouch: true });
    expect(colorForId('abc')).toBe(colorForId('abc'));
    expect(USER_COLORS).toContain(colorForId('someone'));
  });
});
