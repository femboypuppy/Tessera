import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availableLocales,
  createTranslator,
  getLocale,
  registerStrings,
  setLocale,
  t,
} from './i18n';

afterEach(() => setLocale('en'));

describe('t()', () => {
  const tt = createTranslator('test', {
    hello: 'Hello, {name}!',
    pages_one: '{count} page',
    pages_other: '{count} pages',
    pages_zero: 'No pages',
    onlyEnglish: 'Only in English',
  });

  it('interpolates and pluralizes', () => {
    expect(tt('hello', { name: 'Ada' })).toBe('Hello, Ada!');
    expect(tt('pages', { count: 1 })).toBe('1 page');
    expect(tt('pages', { count: 1234 })).toBe('1,234 pages');
    expect(tt('pages', { count: 0 })).toBe('No pages');
    expect(t('test:hello', { name: 'Grace' })).toBe('Hello, Grace!');
  });

  it('uses the active locale and falls back to English and to base locales', () => {
    registerStrings(
      'test',
      { hello: 'Bonjour, {name} !', pages_one: '{count} page', pages_other: '{count} pages' },
      'fr',
    );
    setLocale('fr-CA');
    expect(getLocale()).toBe('fr-CA');
    expect(tt('hello', { name: 'Ada' })).toBe('Bonjour, Ada !');
    expect(tt('onlyEnglish')).toBe('Only in English');
    expect(availableLocales()).toEqual(expect.arrayContaining(['en', 'fr']));
  });

  it('returns the key for missing strings and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(t('test:missing')).toBe('test:missing');
    expect(t('test:missing')).toBe('test:missing');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('rejects namespaces containing a colon', () => {
    expect(() => registerStrings('a:b', {})).toThrow();
  });
});
