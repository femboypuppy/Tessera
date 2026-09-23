/**
 * Tiny i18n runtime. Every user-facing string in Tessera goes through `t()`.
 *
 * - Strings live in namespaces, one per package or feature (`ui`, `shell`, `editor`, …).
 *   A key is written `namespace:key` (for example `t('shell:newPage')`).
 * - English is the source language and always the fallback. Each package ships `src/i18n/en.ts`
 *   and registers it with {@link createTranslator} (or {@link registerStrings}).
 * - Community translations add `src/i18n/<locale>.json` next to `en.ts` with the same keys; the
 *   shell loads the selected locale's files at boot. Changing the language reloads the app, so
 *   components never need to re-render on language changes.
 * - Interpolation: `{name}` placeholders. Plurals: keys with `_zero`, `_one`, `_two`, `_few`,
 *   `_many`, `_other` suffixes are picked with `Intl.PluralRules` when `count` is passed.
 */

/** A flat map of keys to strings for one namespace. */
export type Strings = Readonly<Record<string, string>>;

/** Values interpolated into `{placeholders}`. */
export type TranslationValues = Readonly<Record<string, string | number>>;

export const DEFAULT_LOCALE = 'en';

/** Plural categories of `Intl.PluralRules`, used as key suffixes (`pages_one`, `pages_other`). */
type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

const catalogs = new Map<string, Map<string, Record<string, string>>>();
let currentLocale = DEFAULT_LOCALE;
const warned = new Set<string>();

function catalogFor(locale: string): Map<string, Record<string, string>> {
  let catalog = catalogs.get(locale);
  if (!catalog) {
    catalog = new Map();
    catalogs.set(locale, catalog);
  }
  return catalog;
}

/**
 * Registers (or extends) the strings of a namespace for a locale.
 *
 * @example
 * registerStrings('editor', { slashHeading1: 'Heading 1' });
 * registerStrings('editor', { slashHeading1: 'Titre 1' }, 'fr');
 */
export function registerStrings(
  namespace: string,
  strings: Strings,
  locale: string = DEFAULT_LOCALE,
): void {
  if (namespace.includes(':')) throw new Error(`Namespace "${namespace}" must not contain ":"`);
  const catalog = catalogFor(locale);
  catalog.set(namespace, { ...catalog.get(namespace), ...strings });
}

/** Sets the active locale (call once at boot, before rendering). Unknown locales fall back to English. */
export function setLocale(locale: string): void {
  currentLocale = locale || DEFAULT_LOCALE;
}

/** The active locale, e.g. `en` or `fr-CA`. */
export function getLocale(): string {
  return currentLocale;
}

/** Locales with at least one registered namespace. */
export function availableLocales(): string[] {
  return [...catalogs.keys()].sort();
}

function lookup(locale: string, namespace: string, key: string): string | undefined {
  const exact = catalogs.get(locale)?.get(namespace)?.[key];
  if (exact !== undefined) return exact;
  const base = locale.split('-')[0];
  if (base && base !== locale) return catalogs.get(base)?.get(namespace)?.[key];
  return undefined;
}

function resolve(namespace: string, key: string, values?: TranslationValues): string | undefined {
  const count = values?.count;
  const locales =
    currentLocale === DEFAULT_LOCALE ? [DEFAULT_LOCALE] : [currentLocale, DEFAULT_LOCALE];
  for (const locale of locales) {
    if (typeof count === 'number') {
      let category: PluralSuffix = 'other';
      try {
        category = new Intl.PluralRules(locale).select(count) as PluralSuffix;
      } catch {
        category = 'other';
      }
      const exactZero = count === 0 ? lookup(locale, namespace, `${key}_zero`) : undefined;
      const plural =
        exactZero ??
        lookup(locale, namespace, `${key}_${category}`) ??
        lookup(locale, namespace, `${key}_other`);
      if (plural !== undefined) return plural;
    }
    const found = lookup(locale, namespace, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? new Intl.NumberFormat(currentLocale).format(value) : value;
  });
}

/**
 * Translates `namespace:key`. Missing keys return the key itself (and warn once in development),
 * so a missing string is visible but never crashes.
 *
 * @example
 * t('shell:pageCount', { count: 3 }); // "3 pages"
 */
export function t(fullKey: string, values?: TranslationValues): string {
  const separator = fullKey.indexOf(':');
  const namespace = separator > 0 ? fullKey.slice(0, separator) : 'ui';
  const key = separator > 0 ? fullKey.slice(separator + 1) : fullKey;
  const template = resolve(namespace, key, values);
  if (template === undefined) {
    if (!warned.has(fullKey)) {
      warned.add(fullKey);
      console.warn(`[i18n] Missing string "${fullKey}"`);
    }
    return fullKey;
  }
  return interpolate(template, values);
}

/** Keys of a strings object with plural suffixes folded into their base key. */
export type TranslationKey<S extends Strings> = {
  [K in keyof S & string]: K extends `${infer Base}_${PluralSuffix}` ? Base : K;
}[keyof S & string];

/** A `t` function bound to one namespace, with typed keys. */
export type Translator<S extends Strings> = (
  key: TranslationKey<S>,
  values?: TranslationValues,
) => string;

/**
 * Registers a namespace's English strings and returns a `t` bound to it, with autocompleted keys.
 *
 * @example
 * // packages/editor/src/i18n/en.ts
 * export const en = { slashPlaceholder: "Type '/' for commands", blocks_one: '{count} block', blocks_other: '{count} blocks' } as const;
 * // packages/editor/src/i18n/index.ts
 * export const t = createTranslator('editor', en);
 * t('blocks', { count: 2 }); // "2 blocks"
 */
export function createTranslator<const S extends Strings>(
  namespace: string,
  english: S,
): Translator<S> {
  registerStrings(namespace, english, DEFAULT_LOCALE);
  return (key, values) => t(`${namespace}:${key}`, values);
}
