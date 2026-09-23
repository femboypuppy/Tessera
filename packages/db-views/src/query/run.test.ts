import type { ViewConfig } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property, row, testContext, titles } from '../test/fixtures';
import { runQuery } from './run';
import { compileSearch, type SearchCache } from './search';

const ctx = testContext({ titleOf: (id) => (id === 'p1' ? 'Saturn V' : undefined) });
const name = property('name', 'title');
const status = property('status', 'select', { options: options(['todo'], ['done']) });
const pts = property('pts', 'number');
const due = property('due', 'date');
const rel = property('rel', 'relation');
const done = property('done', 'checkbox');
const props = [name, status, pts, due, rel, done];

const rows = [
  row('Launch pad', { status: 'todo', pts: 3, due: { start: '2026-09-23' } }),
  row('Résumé review', { status: 'done', pts: 1, rel: ['p1'] }),
  row('Trashed', { status: 'todo' }, { trashed: true }),
  row('Missing', { status: 'todo' }, { missingPage: true }),
  row('Rocket', { status: 'todo', pts: 5, done: true }),
];

const view: Pick<ViewConfig, 'filter' | 'sorts' | 'group'> = {
  filter: {
    type: 'group',
    id: 'root',
    conjunction: 'and',
    children: [{ type: 'condition', id: 'c', propertyId: 'pts', operator: 'gte', value: 1 }],
  },
  sorts: [{ propertyId: 'pts', direction: 'desc' }],
  group: {
    propertyId: 'status',
    order: [],
    hidden: [],
    collapsed: [],
    hideEmptyGroups: true,
    dateBucket: 'month',
  },
};

describe('runQuery', () => {
  it('drops trashed and missing rows, filters, sorts and groups', () => {
    const result = runQuery(rows, props, view, ctx);
    expect(result.total).toBe(3);
    expect(titles(result.rows)).toEqual(['Rocket', 'Launch pad', 'Résumé review']);
    expect(result.groups?.map((group) => `${group.key}:${titles(group.rows).join('|')}`)).toEqual([
      'todo:Rocket|Launch pad',
      'done:Résumé review',
    ]);
  });

  it('searches and can skip grouping', () => {
    const result = runQuery(rows, props, view, ctx, { search: 'resume', group: false });
    expect(titles(result.rows)).toEqual(['Résumé review']);
    expect(result.groups).toBeNull();
    const none = runQuery(rows, props, { filter: null, sorts: [], group: null }, ctx);
    expect(titles(none.rows)).toEqual(['Launch pad', 'Résumé review', 'Rocket']);
    const group = view.group ? { ...view.group, propertyId: 'ghost' } : null;
    expect(runQuery(rows, props, { ...view, group }, ctx).groups).toBeNull();
  });
});

describe('compileSearch', () => {
  it('matches every word across searchable cells, ignoring case and accents', () => {
    const test = (query: string) => {
      const predicate = compileSearch(query, props, ctx);
      return predicate ? titles(rows.filter(predicate)) : null;
    };
    expect(test('')).toBeNull();
    expect(test('   ')).toBeNull();
    expect(test('LAUNCH')).toEqual(['Launch pad']);
    expect(test('done review')).toEqual(['Résumé review']);
    expect(test('saturn')).toEqual(['Résumé review']);
    expect(test('2026-09-23')).toEqual(['Launch pad']);
    expect(test('5')).toEqual(['Rocket']);
    expect(test('yes')).toEqual([]);
    expect(test('todo rocket')).toEqual(['Rocket']);
    expect(test('todo zebra')).toEqual([]);
  });

  it('reuses its cache', () => {
    const cache: SearchCache = new WeakMap();
    const first = rows[0];
    if (!first) throw new Error('fixture');
    compileSearch('pad', props, ctx, cache)?.(first);
    expect(cache.get(first)).toContain('launch pad');
    cache.set(first, 'cached text');
    expect(compileSearch('cached', props, ctx, cache)?.(first)).toBe(true);
  });
});
