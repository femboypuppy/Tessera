import { describe, expect, it } from 'vitest';
import { highlightTerms, normalizeTerm, snippetAround, tokenize } from './text';

const slices = (text: string, ranges: Array<{ start: number; end: number }>) =>
  ranges.map((range) => text.slice(range.start, range.end));

describe('text helpers', () => {
  it('tokenizes on whitespace and punctuation and folds case and accents', () => {
    expect(tokenize('Launch plan: Q3, café-crème!')).toEqual([
      'Launch',
      'plan',
      'Q3',
      'café',
      'crème',
    ]);
    expect(normalizeTerm('Café')).toBe('cafe');
    expect(normalizeTerm('ÉCOLE')).toBe('ecole');
  });

  it('highlights whole tokens whose term matched', () => {
    const text = 'Apollo, the apollonian APOLLO program';
    expect(slices(text, highlightTerms(text, new Set(['apollo'])))).toEqual(['Apollo', 'APOLLO']);
    expect(highlightTerms(text, new Set())).toEqual([]);
  });

  it('cuts snippets around the first match, with ellipses and shifted highlights', () => {
    const before = 'Background notes about the mission and many unrelated details. '.repeat(3);
    const after = ' More text follows here to make the paragraph long enough to cut. '.repeat(3);
    const text = `${before}The rendezvous happened over Hawaii.${after}`;
    const snippet = snippetAround(text, new Set(['rendezvous']));
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.text.length).toBeLessThanOrEqual(164);
    expect(slices(snippet.text, snippet.highlights)).toEqual(['rendezvous']);
  });

  it('keeps short text whole', () => {
    const snippet = snippetAround('Short   text\nwith Apollo', new Set(['apollo']));
    expect(snippet.text).toBe('Short text with Apollo');
    expect(slices(snippet.text, snippet.highlights)).toEqual(['Apollo']);
  });
});
