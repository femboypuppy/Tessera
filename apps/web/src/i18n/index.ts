import { SETTING_KEYS, type SettingsStore } from '@tessera/core';
import { createTranslator, registerStrings, setLocale, DEFAULT_LOCALE } from '@tessera/ui';
import { en } from './en';

/** `t` for the `shell` namespace. */
export const t = createTranslator('shell', en);

/**
 * Translation files: `apps/web/src/i18n/<locale>.json` (namespace `shell`) and
 * `packages/<pkg>/src/i18n/<locale>.json` (namespace = the package folder name, or the value of a
 * top-level `"$namespace"` key). English lives in TypeScript and is always loaded.
 */
const localeFiles = import.meta.glob<Record<string, string>>(
  ['./*.json', '../../../../packages/*/src/i18n/*.json'],
  {
    import: 'default',
  },
);

/** Locales that have at least one translation file, plus English. */
export function availableLocales(): string[] {
  const locales = new Set([DEFAULT_LOCALE]);
  for (const path of Object.keys(localeFiles)) {
    const match = /([\w-]+)\.json$/.exec(path);
    if (match?.[1]) locales.add(match[1]);
  }
  return [...locales].sort();
}

function namespaceOf(path: string, strings: Record<string, string>): string {
  if (typeof strings.$namespace === 'string') return strings.$namespace;
  const pkg = /packages\/([^/]+)\/src\/i18n\//.exec(path)?.[1];
  return pkg ?? 'shell';
}

/**
 * Picks the locale (saved setting, else the browser language when we have it, else English) and
 * loads its translation files. Runs before any feature module is imported.
 */
export async function initI18n(settings: SettingsStore): Promise<string> {
  const saved = settings.get(SETTING_KEYS.language);
  const available = availableLocales();
  const browser =
    typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? [navigator.language])];
  const candidates = [typeof saved === 'string' ? saved : null, ...browser].filter(
    (value): value is string => !!value,
  );
  const locale =
    candidates.find((candidate) => available.includes(candidate)) ??
    candidates
      .map((candidate) => candidate.split('-')[0] ?? '')
      .find((base) => available.includes(base)) ??
    DEFAULT_LOCALE;
  setLocale(locale);
  if (locale !== DEFAULT_LOCALE) {
    await Promise.all(
      Object.entries(localeFiles)
        .filter(([path]) => path.endsWith(`/${locale}.json`))
        .map(async ([path, load]) => {
          const strings = await load();
          const { $namespace: _ignored, ...rest } = strings;
          registerStrings(namespaceOf(path, strings), rest, locale);
        }),
    );
  }
  document.documentElement.lang = locale;
  return locale;
}

/** Native name of a locale ("English", "Français"). */
export function localeName(locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

export { en as shellStrings };
