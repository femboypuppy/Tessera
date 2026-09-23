import { MemorySettingsStore, SETTING_KEYS } from '@tessera/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followTheme, getThemePreference, resolveTheme, toggleTheme } from './theme';

/** Replaces `matchMedia` with an OS color scheme the test controls. */
function mockSystemTheme(initiallyDark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initiallyDark,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => media as unknown as MediaQueryList);
  return {
    listeners,
    setDark(dark: boolean) {
      media.matches = dark;
      for (const listener of [...listeners]) listener();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('theme preference', () => {
  it('reads light and dark, and treats anything else as system', () => {
    expect(getThemePreference(new MemorySettingsStore())).toBe('system');
    expect(getThemePreference(new MemorySettingsStore({ [SETTING_KEYS.theme]: 'dark' }))).toBe(
      'dark',
    );
    expect(getThemePreference(new MemorySettingsStore({ [SETTING_KEYS.theme]: 'light' }))).toBe(
      'light',
    );
    expect(getThemePreference(new MemorySettingsStore({ [SETTING_KEYS.theme]: 'sepia' }))).toBe(
      'system',
    );
    expect(getThemePreference(new MemorySettingsStore({ [SETTING_KEYS.theme]: 42 }))).toBe(
      'system',
    );
  });

  it('resolves system to what the OS prefers', () => {
    const system = mockSystemTheme(true);
    expect(resolveTheme('system')).toBe('dark');
    system.setDark(false);
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('toggles from the theme currently shown', () => {
    mockSystemTheme(true);
    const settings = new MemorySettingsStore();
    toggleTheme(settings);
    expect(settings.get(SETTING_KEYS.theme)).toBe('light');
    toggleTheme(settings);
    expect(settings.get(SETTING_KEYS.theme)).toBe('dark');
  });
});

describe('followTheme', () => {
  it('applies the theme now, on setting changes and on OS changes, until stopped', () => {
    const system = mockSystemTheme(false);
    const settings = new MemorySettingsStore();
    const root = document.documentElement;

    const stop = followTheme(settings);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');

    system.setDark(true);
    expect(root.dataset.theme).toBe('dark');

    settings.set(SETTING_KEYS.theme, 'light');
    expect(root.dataset.theme).toBe('light');
    // An explicit choice ignores the OS.
    system.setDark(false);
    system.setDark(true);
    expect(root.dataset.theme).toBe('light');

    stop();
    expect(system.listeners.size).toBe(0);
    settings.set(SETTING_KEYS.theme, 'dark');
    expect(root.dataset.theme).toBe('light');
  });
});
