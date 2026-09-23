import { describe, expect, it } from 'vitest';
import { PluginError } from './errors';
import { findProperty, resolveRowInput, runRowQuery } from './query';
import type { DatabaseProperty, DatabaseRow, JsonValue } from './types';

const properties: DatabaseProperty[] = [
  { id: 'p-title', name: 'Name', type: 'title' },
  {
    id: 'p-status',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'o-todo', name: 'To do', color: 'gray' },
      { id: 'o-doing', name: 'Doing', color: 'blue' },
      { id: 'o-done', name: 'Done', color: 'green' },
    ],
  },
  {
    id: 'p-tags',
    name: 'Tags',
    type: 'multiSelect',
    options: [
      { id: 'o-space', name: 'Space', color: 'purple' },
      { id: 'o-moon', name: 'Moon', color: 'yellow' },
    ],
  },
  { id: 'p-pages', name: 'Pages', type: 'number' },
  { id: 'p-due', name: 'Due', type: 'date' },
  { id: 'p-read', name: 'Read', type: 'checkbox' },
  { id: 'p-notes', name: 'Notes', type: 'text' },
  { id: 'p-created', name: 'Created', type: 'createdTime' },
];

function row(id: string, title: string, values: Record<string, JsonValue>): DatabaseRow {
  return {
    id,
    title,
    icon: null,
    createdAt: 0,
    updatedAt: 0,
    values: { 'p-title': title, 'p-created': Number(id.slice(1)) * 1000, ...values },
  };
}

const rows: DatabaseRow[] = [
  row('r1', 'Dune', {
    'p-status': 'o-done',
    'p-tags': ['o-space'],
    'p-pages': 412,
    'p-due': { start: '2026-10-01' },
    'p-read': true,
    'p-notes': 'Spice and sand',
  }),
  row('r2', 'Moon logbook', {
    'p-status': 'o-doing',
    'p-tags': ['o-moon', 'o-space'],
    'p-pages': 120,
    'p-due': { start: '2026-09-15' },
  }),
  row('r3', 'Apollo 11', { 'p-status': 'o-todo', 'p-pages': 280, 'p-notes': 'Moon landing' }),
  row('r4', 'Untitled draft', {}),
];

const titles = (result: { rows: DatabaseRow[] }) => result.rows.map((r) => r.title);

describe('runRowQuery', () => {
  it('returns every row in order without a query', () => {
    expect(titles(runRowQuery(properties, rows))).toEqual([
      'Dune',
      'Moon logbook',
      'Apollo 11',
      'Untitled draft',
    ]);
  });

  it('filters selects by option name or ID', () => {
    const byName = { property: 'status', operator: 'equals', value: 'done' } as const;
    expect(titles(runRowQuery(properties, rows, { filters: [byName] }))).toEqual(['Dune']);
    const byId = { property: 'p-status', operator: 'notEquals', value: 'o-done' } as const;
    expect(titles(runRowQuery(properties, rows, { filters: [byId] }))).toEqual([
      'Moon logbook',
      'Apollo 11',
      'Untitled draft',
    ]);
  });

  it('filters multi-selects, numbers, text, checkboxes, dates and emptiness', () => {
    const run = (filter: Parameters<typeof runRowQuery>[2]) =>
      titles(runRowQuery(properties, rows, filter));
    expect(run({ filters: [{ property: 'Tags', operator: 'contains', value: 'Moon' }] })).toEqual([
      'Moon logbook',
    ]);
    expect(run({ filters: [{ property: 'Pages', operator: 'greaterThan', value: 200 }] })).toEqual([
      'Dune',
      'Apollo 11',
    ]);
    expect(run({ filters: [{ property: 'Pages', operator: 'lessThan', value: '200' }] })).toEqual([
      'Moon logbook',
    ]);
    expect(run({ filters: [{ property: 'Notes', operator: 'contains', value: 'MOON' }] })).toEqual([
      'Apollo 11',
    ]);
    expect(run({ filters: [{ property: 'Read', operator: 'equals', value: true }] })).toEqual([
      'Dune',
    ]);
    expect(
      run({ filters: [{ property: 'Due', operator: 'lessThan', value: '2026-09-30' }] }),
    ).toEqual(['Moon logbook']);
    expect(
      run({ filters: [{ property: 'Due', operator: 'equals', value: '2026-10-01' }] }),
    ).toEqual(['Dune']);
    expect(run({ filters: [{ property: 'Notes', operator: 'isEmpty' }] })).toEqual([
      'Moon logbook',
      'Untitled draft',
    ]);
    expect(run({ filters: [{ property: 'Name', operator: 'contains', value: 'moon' }] })).toEqual([
      'Moon logbook',
    ]);
  });

  it('combines filters with AND', () => {
    const result = runRowQuery(properties, rows, {
      filters: [
        { property: 'Tags', operator: 'contains', value: 'Space' },
        { property: 'Pages', operator: 'greaterThan', value: 300 },
      ],
    });
    expect(titles(result)).toEqual(['Dune']);
  });

  it('sorts by several properties with empty cells last in both directions', () => {
    expect(
      titles(
        runRowQuery(properties, rows, { sorts: [{ property: 'Pages', direction: 'descending' }] }),
      ),
    ).toEqual(['Dune', 'Apollo 11', 'Moon logbook', 'Untitled draft']);
    expect(titles(runRowQuery(properties, rows, { sorts: [{ property: 'Status' }] }))).toEqual([
      'Apollo 11',
      'Moon logbook',
      'Dune',
      'Untitled draft',
    ]);
    expect(titles(runRowQuery(properties, rows, { sorts: [{ property: 'Name' }] }))).toEqual([
      'Apollo 11',
      'Dune',
      'Moon logbook',
      'Untitled draft',
    ]);
  });

  it('pages results and reports the total', () => {
    const result = runRowQuery(properties, rows, {
      sorts: [{ property: 'Name' }],
      limit: 2,
      offset: 1,
    });
    expect(titles(result)).toEqual(['Dune', 'Moon logbook']);
    expect(result.total).toBe(4);
    expect(runRowQuery(properties, rows, { limit: 1e9 }).rows).toHaveLength(4);
  });

  it('explains unknown properties, unknown options and missing values', () => {
    expect(() =>
      runRowQuery(properties, rows, { filters: [{ property: 'Author', operator: 'isEmpty' }] }),
    ).toThrow(/no property "Author"/);
    expect(() =>
      runRowQuery(properties, rows, {
        filters: [{ property: 'Status', operator: 'equals', value: 'Blocked' }],
      }),
    ).toThrow(/no option "Blocked"/);
    expect(() =>
      runRowQuery(properties, rows, { filters: [{ property: 'Pages', operator: 'equals' }] }),
    ).toThrow(PluginError);
  });
});

describe('resolveRowInput', () => {
  it('maps names to IDs, option names to IDs and the title column to the title', () => {
    expect(
      resolveRowInput(properties, {
        values: {
          Name: 'Hyperion',
          Status: 'doing',
          Tags: ['Moon', 'o-moon', 'space'],
          Pages: 482,
        },
      }),
    ).toEqual({
      title: 'Hyperion',
      values: { 'p-status': 'o-doing', 'p-tags': ['o-moon', 'o-space'], 'p-pages': 482 },
    });
    expect(resolveRowInput(properties, { title: 'X', values: { Notes: null } })).toEqual({
      title: 'X',
      values: { 'p-notes': null },
    });
  });

  it('rejects computed properties and malformed selects', () => {
    expect(() => resolveRowInput(properties, { values: { Created: 1 } })).toThrow(/computed/);
    expect(() => resolveRowInput(properties, { values: { Tags: 'Moon' } })).toThrow(/list/);
    expect(() => resolveRowInput(properties, { values: { Name: 5 } })).toThrow(/title/);
  });

  it('finds properties by trimmed, case-insensitive names', () => {
    expect(findProperty(properties, '  STATUS ')?.id).toBe('p-status');
    expect(findProperty(properties, 'missing')).toBeUndefined();
  });
});
