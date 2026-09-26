import { describe, expect, it } from 'vitest';
import { formatQuery, hasFilters, parseQuery } from './query';

describe('parseQuery', () => {
  it('separates free text from filters', () => {
    expect(parseQuery('apollo tag:space in:Projects type:page is:task landing')).toEqual({
      text: 'apollo landing',
      tags: ['space'],
      within: ['Projects'],
      kinds: ['page'],
      hasTasks: true,
    });
  });

  it('reads #tags, quoted in: titles and database types', () => {
    const parsed = parseQuery('#Project/Alpha in:"Mission notes" type:db retro');
    expect(parsed.tags).toEqual(['Project/Alpha']);
    expect(parsed.within).toEqual(['Mission notes']);
    expect(parsed.kinds).toEqual(['database']);
    expect(parsed.text).toBe('retro');
  });

  it('keeps unknown or empty filters as text', () => {
    expect(parseQuery('http://example.com is:open tag:').text).toBe(
      'http://example.com is:open tag:',
    );
    expect(parseQuery('#1984').tags).toEqual([]);
    expect(parseQuery('#1984').text).toBe('#1984');
  });

  it('treats quoted phrases as text and ignores duplicates', () => {
    const parsed = parseQuery('"moon landing" tag:space #space');
    expect(parsed.text).toBe('moon landing');
    expect(parsed.tags).toEqual(['space']);
  });

  it('round-trips through formatQuery', () => {
    const parsed = parseQuery('retro in:"Mission notes" tag:space type:database is:task');
    expect(formatQuery(parsed)).toBe('retro tag:space in:"Mission notes" type:database is:task');
    expect(parseQuery(formatQuery(parsed))).toEqual(parsed);
    expect(hasFilters(parsed)).toBe(true);
    expect(hasFilters(parseQuery('plain words'))).toBe(false);
  });

  it('reads a pasted wall of text in linear time', () => {
    // `""""…` took about 6 s at 40,000 characters when a key could run over quotes and colons.
    const started = performance.now();
    for (const query of ['""'.repeat(25_000), 'a:'.repeat(25_000), `in:"${'!'.repeat(50_000)}`]) {
      parseQuery(query);
    }
    expect(performance.now() - started).toBeLessThan(1000);
    expect(parseQuery('in:"Mission notes" x:y:"z"').within).toEqual(['Mission notes']);
  });
});
