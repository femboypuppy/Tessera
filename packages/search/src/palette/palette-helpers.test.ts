import { MemorySettingsStore, type Command } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { parseSearchParams, searchUrl } from '../search-page/location';
import { focusSnippet } from '../ui/common';
import { matchCommands } from './match-commands';
import { pushRecent, readRecent } from './recent';
import { paletteStore } from './store';

const command = (id: string, title: string, keywords?: string[]): Command => {
  const result: Command = { id, title, run: () => undefined };
  if (keywords) result.keywords = keywords;
  return result;
};

describe('matchCommands', () => {
  const commands = [
    command('shell.toggleTheme', 'Toggle dark mode', ['theme']),
    command('shell.toggleSidebar', 'Toggle sidebar'),
    command('graph.open', 'Open graph view', ['map']),
    command('shell.openSettings', 'Open settings'),
  ];

  it('matches word prefixes in titles and keywords, best first', () => {
    expect(matchCommands(commands, 'tog').map((c) => c.id)).toEqual([
      'shell.toggleTheme',
      'shell.toggleSidebar',
    ]);
    expect(matchCommands(commands, 'dark').map((c) => c.id)).toEqual(['shell.toggleTheme']);
    expect(matchCommands(commands, 'theme').map((c) => c.id)).toEqual(['shell.toggleTheme']);
    expect(matchCommands(commands, 'open gra').map((c) => c.id)).toEqual(['graph.open']);
    expect(matchCommands(commands, 'map').map((c) => c.id)).toEqual(['graph.open']);
    expect(matchCommands(commands, 'zzz')).toEqual([]);
    expect(matchCommands(commands, '')).toHaveLength(4);
  });
});

describe('recent pages', () => {
  it('keeps the newest first, unique, per workspace', () => {
    const settings = new MemorySettingsStore();
    pushRecent(settings, 'w1', 'a');
    pushRecent(settings, 'w1', 'b');
    pushRecent(settings, 'w1', 'a');
    pushRecent(settings, 'w2', 'z');
    expect(readRecent(settings, 'w1')).toEqual(['a', 'b']);
    expect(readRecent(settings, 'w2')).toEqual(['z']);
    for (let i = 0; i < 30; i += 1) pushRecent(settings, 'w1', `p${i}`);
    expect(readRecent(settings, 'w1')).toHaveLength(20);
    settings.set('search.recent.w3', 'not a list');
    expect(readRecent(settings, 'w3')).toEqual([]);
  });
});

describe('palette store', () => {
  it('opens with a query, toggles, and starts a new session each time', () => {
    const seen: boolean[] = [];
    const off = paletteStore.subscribe(() => seen.push(paletteStore.getState().open));
    paletteStore.open('>');
    const first = paletteStore.getState();
    expect(first).toMatchObject({ open: true, initialQuery: '>' });
    paletteStore.toggle();
    expect(paletteStore.getState().open).toBe(false);
    paletteStore.toggle();
    expect(paletteStore.getState().session).toBe(first.session + 1);
    paletteStore.close();
    off();
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe('search location', () => {
  it('reads and writes /search URLs', () => {
    expect(parseSearchParams('?q=apollo+tag%3Aspace&page=3&rows=0')).toEqual({
      query: 'apollo tag:space',
      page: 3,
      includeRows: false,
    });
    expect(parseSearchParams('?page=-2')).toEqual({ query: '', page: 1, includeRows: true });
    expect(searchUrl({ query: '#space', page: 2 })).toBe('/search?q=%23space&page=2');
    expect(searchUrl({})).toBe('/search');
  });
});

describe('focusSnippet', () => {
  it('moves the window so the first highlight is near the start', () => {
    const text =
      'Background words that come first and are long enough to push it. Then Europa appears.';
    const start = text.indexOf('Europa');
    const focused = focusSnippet({ text, highlights: [{ start, end: start + 6 }] }, 10);
    expect(focused.text.startsWith('…')).toBe(true);
    const range = focused.highlights[0];
    expect(range && focused.text.slice(range.start, range.end)).toBe('Europa');
    expect(focusSnippet({ text: 'Short Europa', highlights: [{ start: 6, end: 12 }] })).toEqual({
      text: 'Short Europa',
      highlights: [{ start: 6, end: 12 }],
    });
  });
});
