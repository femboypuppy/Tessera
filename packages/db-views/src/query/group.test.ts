import { EMPTY_GROUP_KEY, type GroupConfig } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property, row, testContext, titles } from '../test/fixtures';
import { groupKeyReader, groupRows } from './group';

const ctx = testContext();

function config(propertyId: string, patch: Partial<GroupConfig> = {}): GroupConfig {
  return {
    propertyId,
    order: [],
    hidden: [],
    collapsed: [],
    hideEmptyGroups: false,
    dateBucket: 'month',
    ...patch,
  };
}

function summary(groups: ReturnType<typeof groupRows>) {
  return groups.map((group) => `${group.key}:${titles(group.rows).join(',')}`);
}

describe('groupRows', () => {
  const status = property('status', 'select', { options: options(['todo'], ['doing'], ['done']) });

  it('lists every option (and the empty group first) for selects', () => {
    const rows = [
      row('a', { status: 'done' }),
      row('b', {}),
      row('c', { status: 'todo' }),
      row('d', { status: 'ghost' }),
    ];
    const groups = groupRows(rows, config('status'), status, ctx);
    expect(summary(groups)).toEqual([`${EMPTY_GROUP_KEY}:b,d`, 'todo:c', 'doing:', 'done:a']);
    expect(groups[1]?.option?.name).toBe('Todo');
    expect(groups[0]?.isEmpty).toBe(true);
  });

  it('applies explicit order, hidden, collapsed and hideEmptyGroups', () => {
    const rows = [row('a', { status: 'done' }), row('c', { status: 'todo' })];
    const groups = groupRows(
      rows,
      config('status', {
        order: ['done', 'ghost', 'done', 'todo'],
        hidden: ['todo'],
        collapsed: ['done'],
        hideEmptyGroups: true,
      }),
      status,
      ctx,
    );
    expect(summary(groups)).toEqual(['done:a', 'todo:c']);
    expect(groups[0]?.collapsed).toBe(true);
    expect(groups[1]?.hidden).toBe(true);
  });

  it('puts multi-select rows in every group they have', () => {
    const tags = property('tags', 'multiSelect', { options: options(['red'], ['blue']) });
    const rows = [row('a', { tags: ['red', 'blue'] }), row('b', { tags: ['blue'] }), row('c', {})];
    expect(summary(groupRows(rows, config('tags'), tags, ctx))).toEqual([
      `${EMPTY_GROUP_KEY}:c`,
      'red:a',
      'blue:a,b',
    ]);
  });

  it('groups checkboxes unchecked first', () => {
    const done = property('done', 'checkbox');
    const rows = [row('a', { done: true }), row('b', {})];
    expect(summary(groupRows(rows, config('done'), done, ctx))).toEqual(['false:b', 'true:a']);
  });

  it('buckets dates by day, week, month and year in the viewer zone', () => {
    const due = property('due', 'date');
    const rows = [
      row('late', { due: { start: '2026-09-30T23:30:00Z', includeTime: true } }),
      row('sep', { due: { start: '2026-09-02', end: '2026-10-05' } }),
      row('aug', { due: { start: '2025-08-10' } }),
      row('none', {}),
    ];
    expect(summary(groupRows(rows, config('due', { dateBucket: 'month' }), due, ctx))).toEqual([
      '2025-08:aug',
      '2026-09:late,sep',
      `${EMPTY_GROUP_KEY}:none`,
    ]);
    const tokyo = testContext({ timeZone: 'Asia/Tokyo' });
    expect(summary(groupRows(rows, config('due', { dateBucket: 'month' }), due, tokyo))[1]).toBe(
      '2026-09:sep',
    );
    expect(summary(groupRows(rows, config('due', { dateBucket: 'year' }), due, ctx))[0]).toBe(
      '2025:aug',
    );
    expect(summary(groupRows(rows, config('due', { dateBucket: 'week' }), due, ctx))[0]).toBe(
      '2025-W32:aug',
    );
    expect(summary(groupRows(rows, config('due', { dateBucket: 'day' }), due, ctx))[1]).toBe(
      '2026-09-02:sep',
    );
  });

  it('buckets created and updated times', () => {
    const created = property('created', 'createdTime');
    const updated = property('updated', 'updatedTime');
    const rows = [
      row('a', {}, { createdAt: Date.UTC(2026, 0, 5), updatedAt: Date.UTC(2026, 8, 1) }),
      row('b', {}, { createdAt: Date.UTC(2026, 0, 6), updatedAt: Date.UTC(2026, 8, 2) }),
    ];
    expect(
      summary(groupRows(rows, config('created', { dateBucket: 'day' }), created, ctx)),
    ).toEqual(['2026-01-05:a', '2026-01-06:b']);
    expect(summary(groupRows(rows, config('updated'), updated, ctx))).toEqual(['2026-09:a,b']);
  });

  it('groups numbers numerically and text with the collator', () => {
    const pts = property('pts', 'number');
    const numberRows = [row('ten', { pts: 10 }), row('two', { pts: 2 }), row('none', {})];
    expect(summary(groupRows(numberRows, config('pts'), pts, ctx))).toEqual([
      '2:two',
      '10:ten',
      `${EMPTY_GROUP_KEY}:none`,
    ]);
    const kind = property('kind', 'text');
    const textRows = [row('1', { kind: 'b' }), row('2', { kind: 'A' }), row('3', { kind: ' ' })];
    expect(summary(groupRows(textRows, config('kind'), kind, ctx))).toEqual([
      'A:2',
      'b:1',
      `${EMPTY_GROUP_KEY}:3`,
    ]);
    const title = property('title', 'title');
    expect(groupRows([row('x')], config('title'), title, ctx).map((g) => g.key)).toEqual(['x']);
  });

  it('groups relations by their page set and formulas as empty', () => {
    const rel = property('rel', 'relation');
    const rows = [row('a', { rel: ['p1', 'p2'] }), row('b', { rel: ['p1', 'p2'] }), row('c', {})];
    expect(summary(groupRows(rows, config('rel'), rel, ctx))).toEqual([
      'p1,p2:a,b',
      `${EMPTY_GROUP_KEY}:c`,
    ]);
    const formula = property('f', 'formula');
    expect(groupKeyReader(formula, config('f'), ctx)(row('x'))).toEqual([EMPTY_GROUP_KEY]);
  });
});
