import type { FilterGroup, JsonValue, ViewConfig } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { NOW, options, property, testContext } from '../test/fixtures';
import { filterRows } from './filter';
import { runQuery } from './run';
import type { QueryRow } from './types';

/*
 * The budget from SPEC section 10: filtering 10,000 rows takes under 50 ms. Each measurement is
 * the fastest of several runs after a warm-up: other processes (parallel test workers, a busy
 * machine) and GC pauses only ever add time, so the fastest run is the code's own cost.
 */

const ROWS = 10_000;
const ctx = testContext();
const status = property('status', 'select', {
  options: options(['backlog'], ['todo'], ['doing'], ['review'], ['done']),
});
const tags = property('tags', 'multiSelect', {
  options: options(['design'], ['research'], ['ops'], ['growth']),
});
const props = [
  property('name', 'title'),
  status,
  tags,
  property('points', 'number'),
  property('due', 'date'),
  property('done', 'checkbox'),
  property('notes', 'text'),
];

function makeRows(): QueryRow[] {
  const statusIds = status.options?.map((option) => option.id) ?? [];
  const tagIds = tags.options?.map((option) => option.id) ?? [];
  const rows: QueryRow[] = [];
  for (let i = 0; i < ROWS; i += 1) {
    const day = new Date(NOW + ((i % 120) - 60) * 86_400_000).toISOString().slice(0, 10);
    const values: Record<string, JsonValue> = {
      status: statusIds[i % statusIds.length] ?? 'todo',
      tags: [tagIds[i % tagIds.length] ?? 'ops', tagIds[(i * 7) % tagIds.length] ?? 'ops'].filter(
        (id, index, list) => list.indexOf(id) === index,
      ),
      points: (i * 37) % 13,
      due:
        i % 3 === 0
          ? { start: `${day}T${String(i % 24).padStart(2, '0')}:15:00.000Z`, includeTime: true }
          : { start: day },
      done: i % 4 === 0,
      notes: `Note ${i} about the ${i % 2 ? 'lunar' : 'orbital'} module`,
    };
    rows.push({
      id: `row-${i}`,
      order: `a${String(i).padStart(6, '0')}`,
      title: `Task ${i} ${i % 5 === 0 ? 'Apollo' : 'Gemini'}`,
      values,
      createdAt: NOW - i * 60_000,
      updatedAt: NOW - i * 30_000,
    });
  }
  return rows;
}

const filter: FilterGroup = {
  type: 'group',
  id: 'root',
  conjunction: 'and',
  children: [
    {
      type: 'condition',
      id: 'a',
      propertyId: 'status',
      operator: 'isAnyOf',
      value: ['todo', 'doing', 'review'],
    },
    { type: 'condition', id: 'b', propertyId: 'points', operator: 'gte', value: 3 },
    { type: 'condition', id: 'c', propertyId: 'done', operator: 'is', value: false },
    {
      type: 'group',
      id: 'or',
      conjunction: 'or',
      children: [
        { type: 'condition', id: 'd', propertyId: 'name', operator: 'contains', value: 'apollo' },
        {
          type: 'condition',
          id: 'e',
          propertyId: 'due',
          operator: 'isWithin',
          value: { kind: 'range', range: 'thisMonth' },
        },
        {
          type: 'condition',
          id: 'f',
          propertyId: 'tags',
          operator: 'containsAnyOf',
          value: ['research'],
        },
        { type: 'condition', id: 'g', propertyId: 'notes', operator: 'contains', value: 'lunar' },
      ],
    },
  ],
};

function fastest(run: () => void, times = 12): number {
  run();
  let best = Infinity;
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('query performance (10,000 rows)', () => {
  const rows = makeRows();

  it('filters in under 50 ms', () => {
    let matched = 0;
    const ms = fastest(() => {
      matched = filterRows(rows, filter, props, ctx).length;
    });
    expect(matched).toBeGreaterThan(1000);
    expect(matched).toBeLessThan(ROWS);
    console.info(`filter 10k rows: ${ms.toFixed(1)} ms (${matched} matched)`);
    expect(ms).toBeLessThan(50);
  });

  // Beyond the SPEC budget (filtering only): a whole view query with a cold search (no cache) and
  // three sort rules must stay interactive, even on a loaded machine.
  it('filters, searches and sorts a whole view in under 100 ms', () => {
    const view: Pick<ViewConfig, 'filter' | 'sorts' | 'group'> = {
      filter,
      sorts: [
        { propertyId: 'status', direction: 'asc' },
        { propertyId: 'due', direction: 'desc' },
        { propertyId: 'name', direction: 'asc' },
      ],
      group: null,
    };
    const ms = fastest(() => {
      runQuery(rows, props, view, ctx, { search: 'module' });
    });
    console.info(`filter + search + sort 10k rows: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
  });
});
