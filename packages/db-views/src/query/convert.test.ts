import type { JsonValue, PropertyDefinition, PropertyType } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property, row, testContext } from '../test/fixtures';
import { convertValue, planTypeChange } from './convert';

const ctx = testContext({ titleOf: (id) => ({ p1: 'Moon', p2: 'Mars' })[id] });

function convert(prop: PropertyDefinition, value: JsonValue | undefined, target: PropertyType) {
  const entry = row('Row', value === undefined ? {} : { [prop.id]: value });
  return convertValue(value, entry, prop, target, ctx);
}

describe('convertValue', () => {
  const status = property('status', 'select', { options: options(['todo'], ['done']) });
  const tags = property('tags', 'multiSelect', { options: options(['red'], ['blue']) });

  it('keeps option identity between select and multi-select', () => {
    expect(convert(status, 'done', 'multiSelect')).toEqual({ kind: 'set', value: ['done'] });
    expect(convert(tags, ['blue', 'red'], 'select')).toEqual({ kind: 'set', value: 'blue' });
  });

  it('turns options into names and names into options', () => {
    expect(convert(status, 'done', 'text')).toEqual({ kind: 'set', value: 'Done' });
    expect(convert(tags, ['red', 'blue'], 'text')).toEqual({ kind: 'set', value: 'Red, Blue' });
    expect(convert(property('t', 'text'), 'In review', 'select')).toEqual({
      kind: 'options',
      names: ['In review'],
    });
    expect(convert(property('t', 'text'), 'a, b', 'multiSelect')).toEqual({
      kind: 'options',
      names: ['a', 'b'],
    });
    expect(convert(property('n', 'number'), 3, 'select')).toEqual({
      kind: 'options',
      names: ['3'],
    });
  });

  it('converts numbers, text, checkboxes and dates through text', () => {
    expect(convert(property('n', 'number'), 42, 'text')).toEqual({ kind: 'set', value: '42' });
    expect(convert(property('t', 'text'), '1,234.5', 'number')).toEqual({
      kind: 'set',
      value: 1234.5,
    });
    expect(convert(property('n', 'number'), 0, 'checkbox')).toEqual({ kind: 'set', value: false });
    expect(convert(property('n', 'number'), 2, 'checkbox')).toEqual({ kind: 'set', value: true });
    expect(convert(property('c', 'checkbox'), true, 'number')).toEqual({ kind: 'set', value: 1 });
    expect(convert(property('c', 'checkbox'), true, 'text')).toEqual({ kind: 'set', value: 'Yes' });
    expect(convert(property('t', 'text'), 'yes', 'checkbox')).toEqual({ kind: 'set', value: true });
    expect(convert(property('t', 'text'), 'maybe', 'checkbox')).toBeNull();
    expect(convert(property('d', 'date'), { start: '2026-09-23' }, 'text')).toEqual({
      kind: 'set',
      value: '2026-09-23',
    });
    expect(convert(property('t', 'text'), 'Sep 23, 2026', 'date')).toEqual({
      kind: 'set',
      value: { start: '2026-09-23' },
    });
    expect(convert(property('t', 'text'), 'https://nasa.gov', 'url')).toEqual({
      kind: 'set',
      value: 'https://nasa.gov',
    });
    expect(convert(property('r', 'relation'), ['p1', 'p2'], 'text')).toEqual({
      kind: 'set',
      value: 'Moon, Mars',
    });
  });

  it('leaves values in place when they do not convert', () => {
    expect(convert(property('t', 'text'), 'hello', 'number')).toBeNull();
    expect(convert(property('t', 'text'), 'Moon', 'relation')).toBeNull();
    expect(convert(property('c', 'checkbox'), false, 'text')).toBeNull();
    expect(convert(property('t', 'text'), '   ', 'number')).toBeNull();
    expect(convert(property('t', 'text'), undefined, 'number')).toBeNull();
    expect(convert(status, 'ghost', 'text')).toBeNull();
    expect(convert(tags, ['ghost'], 'select')).toBeNull();
    expect(convert(tags, ['ghost', 'blue'], 'select')).toEqual({ kind: 'set', value: 'blue' });
    expect(convert(status, 'ghost', 'multiSelect')).toBeNull();
    // A leftover from an earlier type (text stored on a number property) stays for switching back.
    expect(convert(property('n', 'number'), 'hello', 'text')).toBeNull();
  });

  it('does nothing for the same type or computed targets', () => {
    expect(convert(property('t', 'text'), 'x', 'text')).toBeNull();
    expect(convert(property('t', 'text'), 'x', 'createdTime')).toBeNull();
    expect(convert(property('t', 'text'), 'x', 'formula')).toBeNull();
    expect(convertValue('x', row('a'), property('title', 'title'), 'text', ctx)).toBeNull();
  });
});

describe('planTypeChange', () => {
  it('plans updates only for rows that convert', () => {
    const pts = property('pts', 'number');
    const rows = [
      row('a', { pts: 1 }, { id: 'a' }),
      row('b', {}, { id: 'b' }),
      row('c', { pts: 'x' }, { id: 'c' }),
    ];
    expect(planTypeChange(rows, pts, 'text', ctx)).toEqual({
      updates: [{ rowId: 'a', change: { kind: 'set', value: '1' } }],
    });
  });
});

describe('formula results', () => {
  const formula = property('f', 'formula', { formula: { expression: 'x' } });
  const plan = (result: JsonValue, target: PropertyType) =>
    planTypeChange([row('a', {}, { id: 'a', formulas: { f: result } })], formula, target, ctx)
      .updates[0]?.change ?? null;

  it('become the values of the new type', () => {
    expect(plan(42, 'text')).toEqual({ kind: 'set', value: '42' });
    expect(plan(42, 'number')).toEqual({ kind: 'set', value: 42 });
    expect(plan(0.5, 'checkbox')).toEqual({ kind: 'set', value: true });
    expect(plan(true, 'number')).toEqual({ kind: 'set', value: 1 });
    expect(plan(true, 'checkbox')).toEqual({ kind: 'set', value: true });
    expect(plan('Long', 'select')).toEqual({ kind: 'options', names: ['Long'] });
    expect(plan({ start: '2026-01-21' }, 'date')).toEqual({
      kind: 'set',
      value: { start: '2026-01-21' },
    });
    expect(plan({ start: '2026-01-21' }, 'text')).toEqual({ kind: 'set', value: '2026-01-21' });
  });

  it('leave nothing behind when empty or false', () => {
    expect(plan(false, 'text')).toBeNull();
    expect(plan('', 'text')).toBeNull();
    expect(planTypeChange([row('a', {}, { id: 'a' })], formula, 'text', ctx).updates).toEqual([]);
  });
});
