import type { SortRule } from '@tessera/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { options, property, row, testContext, titles } from '../test/fixtures';
import { compareSortKeys, sortKeyReader, sortRows } from './sort';
import { sortCollator } from './text';

const ctx = testContext();

describe('sortRows', () => {
  it('sorts text with a numeric, locale-aware collator', () => {
    const name = property('name', 'title');
    const rows = ['Item 10', 'item 2', 'Éclair', 'eclair', 'Zebra', 'apple', 'Item 1'].map((t) =>
      row(t),
    );
    expect(titles(sortRows(rows, [{ propertyId: 'name', direction: 'asc' }], [name], ctx))).toEqual(
      ['apple', 'eclair', 'Éclair', 'Item 1', 'item 2', 'Item 10', 'Zebra'],
    );
    const swedish = testContext({ locale: 'sv-SE' });
    const nordic = ['Ö', 'Z', 'A'].map((t) => row(t));
    expect(
      titles(sortRows(nordic, [{ propertyId: 'name', direction: 'asc' }], [name], swedish)),
    ).toEqual(['A', 'Z', 'Ö']);
  });

  it('keeps empty values last in both directions', () => {
    const pts = property('pts', 'number');
    const rows = [
      row('none', {}),
      row('two', { pts: 2 }),
      row('bad', { pts: 'x' }),
      row('one', { pts: 1 }),
    ];
    expect(titles(sortRows(rows, [{ propertyId: 'pts', direction: 'asc' }], [pts], ctx))).toEqual([
      'one',
      'two',
      'none',
      'bad',
    ]);
    expect(titles(sortRows(rows, [{ propertyId: 'pts', direction: 'desc' }], [pts], ctx))).toEqual([
      'two',
      'one',
      'none',
      'bad',
    ]);
  });

  it('is stable and uses later rules to break ties', () => {
    const status = property('status', 'select', {
      options: options(['todo'], ['doing'], ['done']),
    });
    const pts = property('pts', 'number');
    const rows = [
      row('a', { status: 'done', pts: 1 }),
      row('b', { status: 'todo', pts: 3 }),
      row('c', { status: 'done', pts: 1 }),
      row('d', { status: 'todo', pts: 1 }),
      row('e', { status: 'ghost' }),
    ];
    const props = [status, pts];
    expect(
      titles(sortRows(rows, [{ propertyId: 'status', direction: 'asc' }], props, ctx)),
    ).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(
      titles(
        sortRows(
          rows,
          [
            { propertyId: 'status', direction: 'asc' },
            { propertyId: 'pts', direction: 'desc' },
          ],
          props,
          ctx,
        ),
      ),
    ).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(
      titles(
        sortRows(
          rows,
          [
            { propertyId: 'pts', direction: 'asc' },
            { propertyId: 'status', direction: 'desc' },
          ],
          props,
          ctx,
        ),
      ),
    ).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('returns a copy and skips rules on deleted properties', () => {
    const rows = [row('b'), row('a')];
    const sorted = sortRows(rows, [{ propertyId: 'ghost', direction: 'asc' }], [], ctx);
    expect(titles(sorted)).toEqual(['b', 'a']);
    expect(sorted).not.toBe(rows);
    expect(
      sortRows([row('x')], [{ propertyId: 'x', direction: 'asc' }], [property('x', 'title')], ctx),
    ).toHaveLength(1);
  });

  it('sorts multi-selects by option order', () => {
    const tags = property('tags', 'multiSelect', { options: options(['a'], ['b'], ['c']) });
    const rows = [
      row('c', { tags: ['c'] }),
      row('ab', { tags: ['b', 'a'] }),
      row('a', { tags: ['a'] }),
      row('none', { tags: [] }),
      row('ac', { tags: ['c', 'a'] }),
    ];
    expect(titles(sortRows(rows, [{ propertyId: 'tags', direction: 'asc' }], [tags], ctx))).toEqual(
      ['a', 'ab', 'ac', 'c', 'none'],
    );
  });

  it('interleaves dates with and without times in the viewer zone', () => {
    const due = property('due', 'date');
    const rows = [
      row('day 24', { due: { start: '2026-09-24' } }),
      row('23 at 23:00 UTC', { due: { start: '2026-09-23T23:00:00Z', includeTime: true } }),
      row('day 23', { due: { start: '2026-09-23' } }),
      row('none', {}),
    ];
    expect(titles(sortRows(rows, [{ propertyId: 'due', direction: 'asc' }], [due], ctx))).toEqual([
      'day 23',
      '23 at 23:00 UTC',
      'day 24',
      'none',
    ]);
    // In Tokyo, 23:00 UTC is 08:00 on the 24th, after midnight on the 24th.
    const tokyo = testContext({ timeZone: 'Asia/Tokyo' });
    expect(titles(sortRows(rows, [{ propertyId: 'due', direction: 'asc' }], [due], tokyo))).toEqual(
      ['day 23', 'day 24', '23 at 23:00 UTC', 'none'],
    );
  });

  it('sorts checkboxes, times and relations', () => {
    const done = property('done', 'checkbox');
    const created = property('created', 'createdTime');
    const rel = property('rel', 'relation');
    const rows = [
      row('checked', { done: true, rel: ['p2'] }, { createdAt: 3 }),
      row('unchecked', { rel: ['p1', 'p2'] }, { createdAt: 1 }),
      row('hidden', { rel: ['gone'] }, { createdAt: 2 }),
    ];
    const titleCtx = testContext({
      titleOf: (id) => ({ p1: 'Alpha', p2: 'Beta' })[id],
      isPageVisible: (id) => id !== 'gone',
    });
    const props = [done, created, rel];
    expect(
      titles(sortRows(rows, [{ propertyId: 'done', direction: 'asc' }], props, titleCtx)),
    ).toEqual(['unchecked', 'hidden', 'checked']);
    expect(
      titles(sortRows(rows, [{ propertyId: 'created', direction: 'desc' }], props, titleCtx)),
    ).toEqual(['checked', 'hidden', 'unchecked']);
    expect(
      titles(sortRows(rows, [{ propertyId: 'rel', direction: 'asc' }], props, titleCtx)),
    ).toEqual(['unchecked', 'checked', 'hidden']);
  });

  it('treats formulas as empty', () => {
    const f = property('f', 'formula');
    expect(sortKeyReader(f, ctx)(row('x'))).toBeNull();
  });
});

describe('sortRows against a reference implementation', () => {
  const props = [
    property('name', 'title'),
    property('n1', 'number'),
    property('n2', 'number'),
    property('n3', 'number'),
    property('n4', 'number'),
    property('n5', 'number'),
    property('n6', 'number'),
  ];

  function reference(rows: ReturnType<typeof row>[], sorts: SortRule[]) {
    const collator = sortCollator('en-US');
    const readers = sorts.map((sort) => {
      const prop = props.find((candidate) => candidate.id === sort.propertyId);
      if (!prop) throw new Error('fixture');
      return { read: sortKeyReader(prop, ctx), direction: sort.direction === 'desc' ? -1 : 1 };
    });
    return rows
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        for (const { read, direction } of readers) {
          const ka = read(a.entry);
          const kb = read(b.entry);
          if (ka === null || kb === null) {
            if (ka === kb) continue;
            return ka === null ? 1 : -1;
          }
          const result = compareSortKeys(ka, kb, collator);
          if (result !== 0) return result * direction;
        }
        return a.index - b.index;
      })
      .map(({ entry }) => entry.id);
  }

  it('uses a comparator when the composite key would lose precision', () => {
    // Six rules over 400 distinct values each: 401^6 × 400 is beyond 2^53.
    const rows = Array.from({ length: 400 }, (_, i) =>
      row(
        `r${i}`,
        {
          n1: (i * 7) % 400,
          n2: i % 3,
          n3: (i * 11) % 400,
          n4: (i * 13) % 400,
          n5: (i * 17) % 400,
          n6: (i * 19) % 400,
        },
        { id: `r${i}` },
      ),
    );
    const sorts: SortRule[] = [
      { propertyId: 'n2', direction: 'desc' },
      { propertyId: 'n1', direction: 'asc' },
      { propertyId: 'n3', direction: 'asc' },
      { propertyId: 'n4', direction: 'desc' },
      { propertyId: 'n5', direction: 'asc' },
      { propertyId: 'n6', direction: 'asc' },
    ];
    expect(sortRows(rows, sorts, props, ctx).map((entry) => entry.id)).toEqual(
      reference(rows, sorts),
    );
  });

  it('matches for random data and rules (composite and fallback paths)', () => {
    const numberOrEmpty = fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            title: fc.constantFrom('', 'alpha', 'Alpha', 'beta', 'item 2', 'item 10', 'Éclair'),
            n1: numberOrEmpty,
            n2: numberOrEmpty,
            n3: fc.integer({ min: 0, max: 1_000_000 }),
            n4: fc.integer({ min: 0, max: 1_000_000 }),
            n5: fc.integer({ min: 0, max: 1_000_000 }),
            n6: fc.integer({ min: 0, max: 1_000_000 }),
          }),
          { maxLength: 300 },
        ),
        fc.array(
          fc.record({
            propertyId: fc.constantFrom('name', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'),
            direction: fc.constantFrom('asc' as const, 'desc' as const),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (records, sorts) => {
          const rows = records.map(({ title, ...numbers }, index) => {
            const values: Record<string, number> = {};
            for (const [key, value] of Object.entries(numbers))
              if (value !== undefined) values[key] = value;
            return row(title, values, { id: `r${index}` });
          });
          expect(sortRows(rows, sorts, props, ctx).map((entry) => entry.id)).toEqual(
            reference(rows, sorts),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('compareSortKeys', () => {
  const collator = sortCollator('en-US');
  it('compares every key kind', () => {
    expect(compareSortKeys(null, null, collator)).toBe(0);
    expect(compareSortKeys(null, 1, collator)).toBe(1);
    expect(compareSortKeys(1, null, collator)).toBe(-1);
    expect(compareSortKeys(1, 2, collator)).toBe(-1);
    expect(compareSortKeys(2, 2, collator)).toBe(0);
    expect(compareSortKeys(3, 2, collator)).toBe(1);
    expect(compareSortKeys([1, 2], [1, 3], collator)).toBe(-1);
    expect(compareSortKeys([1, 3], [1, 2], collator)).toBe(1);
    expect(compareSortKeys([1], [1, 2], collator)).toBeLessThan(0);
    expect(compareSortKeys('b', 'a', collator)).toBeGreaterThan(0);
    // Mixed kinds never come from one reader, but still order deterministically (numbers first).
    expect(compareSortKeys('a', 1, collator)).toBe(1);
    expect(compareSortKeys(1, 'a', collator)).toBe(-1);
    expect(compareSortKeys([1], [1], collator)).toBe(0);
  });
});
