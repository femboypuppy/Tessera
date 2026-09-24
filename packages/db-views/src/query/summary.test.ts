import { PROPERTY_TYPES, SUMMARY_KINDS } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property, row, testContext } from '../test/fixtures';
import { SUMMARY_KINDS_BY_TYPE, computeSummary } from './summary';

const ctx = testContext();
const DAY = 86_400_000;

describe('computeSummary', () => {
  it('counts rows, empty values and unique values', () => {
    const notes = property('notes', 'text');
    const rows = [
      row('a', { notes: 'x' }),
      row('b', { notes: 'x ' }),
      row('c', { notes: ' ' }),
      row('d', {}),
    ];
    expect(computeSummary('count', rows, notes, ctx)).toEqual({ type: 'count', value: 4 });
    expect(computeSummary('countEmpty', rows, notes, ctx)).toEqual({ type: 'count', value: 2 });
    expect(computeSummary('countNotEmpty', rows, notes, ctx)).toEqual({ type: 'count', value: 2 });
    expect(computeSummary('countUnique', rows, notes, ctx)).toEqual({ type: 'count', value: 1 });
    expect(computeSummary('percentEmpty', rows, notes, ctx)).toEqual({
      type: 'percent',
      value: 0.5,
    });
    expect(computeSummary('percentNotEmpty', rows, notes, ctx)).toEqual({
      type: 'percent',
      value: 0.5,
    });
    expect(computeSummary('percentEmpty', [], notes, ctx)).toEqual({ type: 'percent', value: 0 });
    expect(computeSummary('none', rows, notes, ctx)).toEqual({ type: 'none' });
  });

  it('counts unique options and relations individually', () => {
    const tags = property('tags', 'multiSelect', { options: options(['a'], ['b'], ['c']) });
    const status = property('status', 'select', { options: options(['todo'], ['done']) });
    const rel = property('rel', 'relation');
    const rows = [
      row('1', { tags: ['a', 'b'], status: 'todo', rel: ['p1'] }),
      row('2', { tags: ['b'], status: 'todo', rel: ['p1', 'p2'] }),
      row('3', { tags: ['ghost'], status: 'ghost' }),
    ];
    expect(computeSummary('countUnique', rows, tags, ctx)).toEqual({ type: 'count', value: 2 });
    expect(computeSummary('countEmpty', rows, tags, ctx)).toEqual({ type: 'count', value: 1 });
    expect(computeSummary('countUnique', rows, status, ctx)).toEqual({ type: 'count', value: 1 });
    expect(computeSummary('countEmpty', rows, status, ctx)).toEqual({ type: 'count', value: 1 });
    expect(computeSummary('countUnique', rows, rel, ctx)).toEqual({ type: 'count', value: 2 });
  });

  it('computes number statistics', () => {
    const pts = property('pts', 'number');
    const rows = [
      row('a', { pts: 0.1 }),
      row('b', { pts: 0.2 }),
      row('c', { pts: 4 }),
      row('d', {}),
      row('e', { pts: 1 }),
    ];
    expect(computeSummary('sum', rows, pts, ctx)).toEqual({ type: 'number', value: 5.3 });
    expect(computeSummary('average', rows, pts, ctx)).toEqual({ type: 'number', value: 1.325 });
    expect(computeSummary('median', rows, pts, ctx)).toEqual({ type: 'number', value: 0.6 });
    expect(computeSummary('median', rows.slice(0, 3), pts, ctx)).toEqual({
      type: 'number',
      value: 0.2,
    });
    expect(computeSummary('min', rows, pts, ctx)).toEqual({ type: 'number', value: 0.1 });
    expect(computeSummary('max', rows, pts, ctx)).toEqual({ type: 'number', value: 4 });
    expect(computeSummary('range', rows, pts, ctx)).toEqual({ type: 'number', value: 3.9 });
    expect(computeSummary('sum', [row('x')], pts, ctx)).toEqual({ type: 'number', value: null });
  });

  it('computes checkbox counts', () => {
    const done = property('done', 'checkbox');
    const rows = [
      row('a', { done: true }),
      row('b', { done: false }),
      row('c', {}),
      row('d', { done: true }),
    ];
    expect(computeSummary('countChecked', rows, done, ctx)).toEqual({ type: 'count', value: 2 });
    expect(computeSummary('countUnchecked', rows, done, ctx)).toEqual({ type: 'count', value: 2 });
    expect(computeSummary('percentChecked', rows, done, ctx)).toEqual({
      type: 'percent',
      value: 0.5,
    });
    expect(computeSummary('percentUnchecked', rows, done, ctx)).toEqual({
      type: 'percent',
      value: 0.5,
    });
    expect(computeSummary('countUnique', rows, done, ctx)).toEqual({ type: 'none' });
  });

  it('computes earliest, latest and the date range', () => {
    const due = property('due', 'date');
    const rows = [
      row('a', { due: { start: '2026-09-10', end: '2026-09-12' } }),
      row('b', { due: { start: '2026-09-01' } }),
      row('c', {
        due: { start: '2026-09-20T15:00:00Z', includeTime: true, timeZone: 'Europe/Paris' },
      }),
      row('d', {}),
    ];
    expect(computeSummary('earliest', rows, due, ctx)).toEqual({
      type: 'date',
      value: { start: '2026-09-01' },
    });
    expect(computeSummary('latest', rows, due, ctx)).toEqual({
      type: 'date',
      value: { start: '2026-09-20T15:00:00Z', includeTime: true, timeZone: 'Europe/Paris' },
    });
    expect(computeSummary('latest', rows.slice(0, 2), due, ctx)).toEqual({
      type: 'date',
      value: { start: '2026-09-12' },
    });
    expect(computeSummary('dateRange', rows.slice(0, 2), due, ctx)).toEqual({
      type: 'duration',
      value: 11 * DAY,
    });
    expect(computeSummary('dateRange', [rows[1] ?? row('x')], due, ctx)).toEqual({
      type: 'duration',
      value: 0,
    });
    expect(computeSummary('dateRange', rows, due, ctx)).toEqual({
      type: 'duration',
      value: 19 * DAY + 15 * 3_600_000,
    });
    expect(computeSummary('earliest', [row('x')], due, ctx)).toEqual({ type: 'date', value: null });
    expect(computeSummary('dateRange', [row('x')], due, ctx)).toEqual({
      type: 'duration',
      value: null,
    });
    expect(computeSummary('countUnique', rows, due, ctx)).toEqual({ type: 'count', value: 3 });
  });

  it('summarizes created and updated times as instants', () => {
    const created = property('created', 'createdTime');
    const rows = [
      row('a', {}, { createdAt: Date.UTC(2026, 0, 1) }),
      row('b', {}, { createdAt: Date.UTC(2026, 0, 3) }),
    ];
    expect(computeSummary('earliest', rows, created, ctx)).toEqual({
      type: 'date',
      value: { start: '2026-01-01T00:00:00.000Z', includeTime: true },
    });
    expect(computeSummary('dateRange', rows, created, ctx)).toEqual({
      type: 'duration',
      value: 2 * DAY,
    });
    const updated = property('updated', 'updatedTime');
    expect(computeSummary('latest', rows, updated, ctx).type).toBe('date');
  });

  it('only offers kinds that apply', () => {
    for (const type of PROPERTY_TYPES) {
      const kinds = SUMMARY_KINDS_BY_TYPE[type];
      expect(kinds[0]).toBe('none');
      for (const kind of kinds) expect(SUMMARY_KINDS).toContain(kind);
    }
    const title = property('t', 'title');
    expect(computeSummary('sum', [row('a')], title, ctx)).toEqual({ type: 'none' });
    expect(computeSummary('countNotEmpty', [row('a'), row('')], title, ctx)).toEqual({
      type: 'count',
      value: 1,
    });
  });
});
