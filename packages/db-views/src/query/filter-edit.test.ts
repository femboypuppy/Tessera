import { FILTER_OPERATORS_BY_TYPE, type FilterCondition, type FilterGroup } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { property } from '../test/fixtures';
import {
  LIST_OPERATORS,
  VALUELESS_OPERATORS,
  adaptValue,
  addNode,
  changeConditionOperator,
  changeConditionProperty,
  countConditions,
  defaultOperator,
  emptyFilter,
  findNode,
  newCondition,
  operatorsFor,
  removeNode,
  replaceNode,
} from './filter-edit';

const status = property('status', 'select');
const tags = property('tags', 'multiSelect');
const done = property('done', 'checkbox');
const due = property('due', 'date');
const points = property('points', 'number');
const name = property('name', 'title');

function condition(id: string, propertyId = 'status'): FilterCondition {
  return { type: 'condition', id, propertyId, operator: 'is', value: 'todo' };
}

describe('filter defaults', () => {
  it('offers a default operator that the type supports', () => {
    for (const type of Object.keys(FILTER_OPERATORS_BY_TYPE) as Array<
      keyof typeof FILTER_OPERATORS_BY_TYPE
    >) {
      expect(operatorsFor(type)).toContain(defaultOperator(type));
    }
    expect(operatorsFor('checkbox')).toBe(FILTER_OPERATORS_BY_TYPE.checkbox);
  });

  it('creates conditions ready to use', () => {
    expect(newCondition(name)).toMatchObject({ propertyId: 'name', operator: 'contains' });
    expect(newCondition(name)).not.toHaveProperty('value');
    expect(newCondition(done)).toMatchObject({ operator: 'is', value: true });
    expect(newCondition(due)).toMatchObject({
      operator: 'is',
      value: { kind: 'relative', unit: 'day', amount: 0 },
    });
    expect(newCondition(status).id).not.toBe(newCondition(status).id);
  });
});

describe('adaptValue', () => {
  it('drops the value for value-less operators', () => {
    for (const operator of VALUELESS_OPERATORS) {
      expect(adaptValue('select', operator, 'todo')).toBeUndefined();
    }
  });

  it('keeps booleans for checkboxes', () => {
    expect(adaptValue('checkbox', 'is', false)).toBe(false);
    expect(adaptValue('checkbox', 'is', 'yes')).toBe(true);
  });

  it('switches dates between a day and a range', () => {
    const week = { kind: 'range', range: 'nextWeek' } as const;
    const day = { kind: 'exact', date: '2026-09-23' } as const;
    expect(adaptValue('date', 'isWithin', week)).toBe(week);
    expect(adaptValue('date', 'isWithin', day)).toEqual({ kind: 'range', range: 'thisWeek' });
    expect(adaptValue('createdTime', 'isBefore', day)).toBe(day);
    expect(adaptValue('updatedTime', 'isAfter', week)).toEqual({
      kind: 'relative',
      unit: 'day',
      amount: 0,
    });
    expect(
      adaptValue('date', 'isWithin', { kind: 'between', start: '2026-09-01', end: '2026-09-30' }),
    ).toMatchObject({ kind: 'between' });
  });

  it('converts between single values and lists', () => {
    for (const operator of LIST_OPERATORS) {
      expect(adaptValue('multiSelect', operator, 'design')).toEqual(['design']);
      expect(adaptValue('multiSelect', operator, ['a', 'b'])).toEqual(['a', 'b']);
      expect(adaptValue('multiSelect', operator, '')).toEqual([]);
      expect(adaptValue('multiSelect', operator, undefined)).toEqual([]);
    }
    expect(adaptValue('select', 'is', ['todo', 'done'])).toBe('todo');
    expect(adaptValue('number', 'gt', 3)).toBe(3);
    expect(adaptValue('number', 'gt', 'three')).toBeUndefined();
    expect(adaptValue('text', 'contains', 'draft')).toBe('draft');
    expect(adaptValue('text', 'contains', 3)).toBeUndefined();
  });
});

describe('filter tree edits', () => {
  it('adds conditions and groups at the root or inside a group', () => {
    const root = addNode(null, condition('a'));
    expect(root).toMatchObject({ type: 'group', conjunction: 'and' });
    expect(root.children.map((child) => child.id)).toEqual(['a']);
    const group: FilterGroup = { type: 'group', id: 'g', conjunction: 'or', children: [] };
    const withGroup = addNode(root, group, root.id);
    const nested = addNode(withGroup, condition('b'), 'g');
    expect(findNode(nested, 'g')).toMatchObject({ children: [{ id: 'b' }] });
    // Edits never mutate the tree they get.
    expect(group.children).toEqual([]);
    expect(root.children).toHaveLength(1);
  });

  it('replaces and finds nodes anywhere', () => {
    const tree = addNode(addNode(emptyFilter(), condition('a')), {
      type: 'group',
      id: 'g',
      conjunction: 'or',
      children: [condition('b'), condition('c')],
    });
    const replaced = replaceNode(tree, 'c', { ...condition('c'), operator: 'isNot' });
    expect(findNode(replaced, 'c')).toMatchObject({ operator: 'isNot' });
    expect(findNode(replaced, tree.id)).toBe(replaced);
    expect(findNode(replaced, 'missing')).toBeUndefined();
    expect(findNode(null, 'a')).toBeUndefined();
    const other: FilterGroup = { type: 'group', id: tree.id, conjunction: 'or', children: [] };
    expect(replaceNode(tree, tree.id, other)).toBe(other);
  });

  it('removes nodes and the groups they leave empty', () => {
    const tree = addNode(addNode(emptyFilter(), condition('a')), {
      type: 'group',
      id: 'g',
      conjunction: 'or',
      children: [condition('b')],
    });
    const removed = removeNode(tree, 'b');
    expect(removed.children.map((child) => child.id)).toEqual(['a']);
    expect(countConditions(tree)).toBe(2);
    expect(countConditions(removed)).toBe(1);
    expect(countConditions(null)).toBe(0);
    expect(countConditions(undefined)).toBe(0);
    expect(countConditions(condition('x'))).toBe(1);
  });

  it('changes the property or operator of a condition', () => {
    const base = newCondition(status);
    const moved = changeConditionProperty(base, tags);
    expect(moved).toMatchObject({ id: base.id, propertyId: 'tags', operator: 'contains' });

    const list = changeConditionOperator({ ...base, value: 'todo' }, status, 'isAnyOf');
    expect(list).toMatchObject({ id: base.id, operator: 'isAnyOf', value: ['todo'] });
    const empty = changeConditionOperator(list, status, 'isEmpty');
    expect(empty).toMatchObject({ operator: 'isEmpty' });
    expect(empty).not.toHaveProperty('value');
    const number = changeConditionOperator(newCondition(points), points, 'gte');
    expect(number).not.toHaveProperty('value');
  });
});
