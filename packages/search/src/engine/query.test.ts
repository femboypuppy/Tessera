import { describe, expect, it } from 'vitest';
import { formatQuery, hasFilters, parseQuery, tokenizeQuery, type QueryToken } from './query';

/**
 * The regex the tokenizer replaced (keys without `:` or `"`), as the reference for what it must
 * return. It runs in linear time here, but CodeQL can't tell, and the scanner is plainer.
 */
function tokenizeWithRegex(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  for (const match of query.matchAll(/([^\s:"]+):"([^"]*)"?|"([^"]*)"?|(\S+)/g)) {
    const [, key, value, phrase, word] = match;
    if (key !== undefined) tokens.push({ kind: 'quoted', key, value: value ?? '' });
    else if (phrase !== undefined) tokens.push({ kind: 'phrase', text: phrase });
    else tokens.push({ kind: 'word', text: word ?? '' });
  }
  return tokens;
}

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

  it('tokenizes every short query exactly as the regex it replaces did', () => {
    // Every string of 1 to 6 characters over the ones that matter: 19,530 queries.
    const alphabet = ['a', ':', '"', ' ', '#'];
    let queries = [''];
    for (let length = 1; length <= 6; length += 1) {
      queries = queries
        .flatMap((query) => (query.length === length - 1 ? alphabet.map((c) => query + c) : []))
        .concat(queries);
      for (const query of queries.filter((candidate) => candidate.length === length)) {
        expect(tokenizeQuery(query), JSON.stringify(query)).toEqual(tokenizeWithRegex(query));
      }
    }
    expect(tokenizeQuery('in:"Mission notes" #space x')).toEqual([
      { kind: 'quoted', key: 'in', value: 'Mission notes' },
      { kind: 'word', text: '#space' },
      { kind: 'word', text: 'x' },
    ]);
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
