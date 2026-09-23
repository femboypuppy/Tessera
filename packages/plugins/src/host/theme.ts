import type { ThemeInfo } from '@tessera/plugin-api';
import type { UiFont } from '../sandbox/runtime-ui';

const PREFIX = '--tess-';
let tokenNames: string[] | null = null;

/** Names of every `--tess-*` custom property declared on `:root` rules (read once). */
function collectTokenNames(doc: Document): string[] {
  if (tokenNames && tokenNames.length) return tokenNames;
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (!rule.selectorText.includes(':root')) continue;
        for (let i = 0; i < rule.style.length; i += 1) {
          const name = rule.style.item(i);
          if (name.startsWith(PREFIX)) names.add(name);
        }
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Cross-origin style sheets can't be read; the app's own are same-origin.
    }
  }
  tokenNames = [...names].sort();
  return tokenNames;
}

/** The current theme: mode, every design token's computed value, reduced motion. */
export function readTheme(doc: Document = document): ThemeInfo {
  const root = doc.documentElement;
  const style = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of collectTokenNames(doc)) {
    const value = style.getPropertyValue(name).trim();
    if (value) tokens[name.slice(PREFIX.length)] = value;
  }
  const mode = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { mode, tokens, reducedMotion };
}

/** Calls `listener` when the theme changes (the `data-theme` attribute or reduced motion). */
export function watchTheme(listener: (theme: ThemeInfo) => void, doc: Document = document) {
  let last = JSON.stringify(readTheme(doc));
  const check = () => {
    const theme = readTheme(doc);
    const serialized = JSON.stringify(theme);
    if (serialized === last) return;
    last = serialized;
    listener(theme);
  };
  const observer = new MutationObserver(check);
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  });
  const motion =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  motion?.addEventListener('change', check);
  return () => {
    observer.disconnect();
    motion?.removeEventListener('change', check);
  };
}

let fontsPromise: Promise<UiFont[]> | null = null;

/**
 * The app's UI font (the first family of `--tess-font-sans`) as font data for plugin frames. The
 * sandbox can't fetch the app's font files (opaque origin, strict CSP), so the host reads the
 * Latin subsets once and passes the bytes. Returns [] when the font isn't found.
 */
export function loadUiFonts(doc: Document = document): Promise<UiFont[]> {
  fontsPromise ??= (async () => {
    const family = getComputedStyle(doc.documentElement)
      .getPropertyValue('--tess-font-sans')
      .split(',')[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
    if (!family) return [];
    const faces: Array<{ url: string; descriptors: UiFont['descriptors'] }> = [];
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const ruleFamily = rule.style
          .getPropertyValue('font-family')
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (ruleFamily !== family) continue;
        const range = rule.style.getPropertyValue('unicode-range');
        // The Latin subsets cover the UI; other scripts fall back to system fonts.
        if (range && !/U\+0000-00FF|U\+0100-02BA|U\+0-FF/i.test(range)) continue;
        const match = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
        if (!match?.[1]) continue;
        const descriptors: UiFont['descriptors'] = { display: 'swap' };
        const weight = rule.style.getPropertyValue('font-weight');
        const fontStyle = rule.style.getPropertyValue('font-style');
        if (weight) descriptors.weight = weight;
        if (fontStyle) descriptors.style = fontStyle;
        if (range) descriptors.unicodeRange = range;
        faces.push({ url: new URL(match[1], sheet.href ?? doc.baseURI).href, descriptors });
      }
    }
    const loaded = await Promise.all(
      faces.slice(0, 4).map(async (face) => {
        try {
          const response = await fetch(face.url);
          if (!response.ok) return null;
          return { family, data: await response.arrayBuffer(), descriptors: face.descriptors };
        } catch {
          return null;
        }
      }),
    );
    return loaded.filter((font): font is UiFont => font !== null);
  })();
  return fontsPromise;
}
