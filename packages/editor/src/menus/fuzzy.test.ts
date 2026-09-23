import { describe, expect, it } from 'vitest';
import { foldText, fuzzyScore, pushRecent, rankItems } from './fuzzy';

const items = [
  { id: 'paragraph', title: 'Text', keywords: ['plain', 'paragraph'] },
  { id: 'heading1', title: 'Heading 1', keywords: ['h1', 'title'] },
  { id: 'heading2', title: 'Heading 2', keywords: ['h2', 'subtitle'] },
  { id: 'heading3', title: 'Heading 3', keywords: ['h3'] },
  { id: 'bulletList', title: 'Bulleted list', keywords: ['unordered', 'ul'] },
  { id: 'orderedList', title: 'Numbered list', keywords: ['ordered', 'ol'] },
  { id: 'taskList', title: 'To-do list', keywords: ['task', 'checkbox'] },
  { id: 'table', title: 'Table', keywords: ['grid'] },
  { id: 'toggle', title: 'Toggle', keywords: ['collapse', 'details'] },
];

describe('fuzzyScore', () => {
  it('ranks exact over prefix over word start over substring over scattered', () => {
    const exact = fuzzyScore('table', 'table');
    const prefix = fuzzyScore('tab', 'table');
    const wordStart = fuzzyScore('list', 'bulleted list');
    const substring = fuzzyScore('ble', 'table');
    const scattered = fuzzyScore('tbl', 'table');
    expect(exact).toBeGreaterThan(prefix ?? 0);
    expect(prefix).toBeGreaterThan(wordStart ?? 0);
    expect(wordStart).toBeGreaterThan(substring ?? 0);
    expect(substring).toBeGreaterThan(scattered ?? 0);
    expect(scattered).toBeGreaterThan(0);
  });

  it('returns null when the characters are not all there in order', () => {
    expect(fuzzyScore('xyz', 'Heading')).toBeNull();
    expect(fuzzyScore('gnidaeh', 'heading')).toBeNull();
  });

  it('ignores case and accents', () => {
    expect(foldText('Résumé')).toBe('resume');
    expect(fuzzyScore('RESUME', 'résumé draft')).not.toBeNull();
  });

  it('requires every token of a multi-word query', () => {
    expect(fuzzyScore('head 2', 'Heading 2')).not.toBeNull();
    expect(fuzzyScore('head 4', 'Heading 2')).toBeNull();
  });
});

describe('rankItems', () => {
  it('keeps every item in order for an empty query, recent ones first when asked', () => {
    expect(rankItems(items, '').map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(
      rankItems(items, '', ['toggle', 'table'])
        .slice(0, 2)
        .map((item) => item.id),
    ).toEqual(['toggle', 'table']);
  });

  it('filters and ranks by title, then keywords', () => {
    expect(rankItems(items, 'head').map((item) => item.id)).toEqual([
      'heading1',
      'heading2',
      'heading3',
    ]);
    expect(rankItems(items, 'h2')[0]?.id).toBe('heading2');
    expect(rankItems(items, 'list').map((item) => item.id)).toEqual([
      'bulletList',
      'orderedList',
      'taskList',
    ]);
    expect(rankItems(items, 'checkbox')[0]?.id).toBe('taskList');
  });

  it('breaks ties by recent use', () => {
    const ranked = rankItems(items, 'heading', ['heading3']);
    expect(ranked[0]?.id).toBe('heading3');
  });

  it('matches typos in order ("tgl" → Toggle)', () => {
    expect(rankItems(items, 'tgl')[0]?.id).toBe('toggle');
  });
});

describe('pushRecent', () => {
  it('moves the item to the front without duplicates and caps the list', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});
