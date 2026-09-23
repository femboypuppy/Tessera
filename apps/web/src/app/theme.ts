import { SETTING_KEYS, type SettingsStore } from '@tessera/core';

/** The theme preference. `system` follows the OS. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Reads the saved preference (key and values shared with public/theme-init.js). */
export function getThemePreference(settings: SettingsStore): ThemePreference {
  const value = settings.get(SETTING_KEYS.theme);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme actually shown for a preference. */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

/** Applies a theme to the document. */
export function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/**
 * Keeps the document theme in sync with the setting (also changed from other tabs) and, for
 * `system`, with the OS. Returns a function that stops following.
 */
export function followTheme(settings: SettingsStore): () => void {
  const update = () => applyTheme(resolveTheme(getThemePreference(settings)));
  update();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  const stop = settings.subscribe((key) => {
    if (key === SETTING_KEYS.theme) update();
  });
  return () => {
    media.removeEventListener('change', update);
    stop();
  };
}

/** Switches between light and dark (from whatever is shown now). */
export function toggleTheme(settings: SettingsStore): void {
  const current = resolveTheme(getThemePreference(settings));
  settings.set(SETTING_KEYS.theme, current === 'dark' ? 'light' : 'dark');
}
