import { EMPTY_GROUP_KEY, type FilterCondition, type FilterGroup } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property, testContext } from '../test/fixtures';
import { newRowDefaults } from './defaults';

const ctx = testContext();
const status = property('status', 'select', { options: options(['todo'], ['done']) });
const tags = property('tags', 'multiSelect', { options: options(['design'], ['api']) });
const done = property('done', 'checkbox');
const owner = property('owner', 'relation');
const note = property('note', 'text');
const link = property('link', 'url');
const points = property('points', 'number');
const due = property('due', 'date');
const created = property('created', 'createdTime');
const properties = [status, tags, done, owner, note, link, points, due, created];

let ids = 0;
function where(
  conjunction: 'and' | 'or',
  ...conditions: Array<Omit<FilterCondition, 'type' | 'id'>>
): FilterGroup {
  return {
    type: 'group',
    id: 'root',
    conjunction,
    children: conditions.map((condition) => {
      ids += 1;
      return { type: 'condition', id: `c${ids}`, ...condition };
    }),
  };
}

describe('newRowDefaults', () => {
  it('fills what top-level AND conditions require', () => {
    const filter = where(
      'and',
      { propertyId: 'status', operator: 'is', value: 'done' },
      { propertyId: 'tags', operator: 'contains', value: 'design' },
      { propertyId: 'done', operator: 'is', value: true },
      { propertyId: 'owner', operator: 'contains', value: 'page-ada' },
      { propertyId: 'note', operator: 'is', value: 'Draft' },
      { propertyId: 'link', operator: 'is', value: 'https://example.org' },
      { propertyId: 'points', operator: 'is', value: 3 },
      { propertyId: 'due', operator: 'is', value: { kind: 'exact', date: '2026-10-01' } },
    );
    expect(newRowDefaults(filter, properties, ctx)).toEqual({
      status: 'done',
      tags: ['design'],
      done: true,
      owner: ['page-ada'],
      note: 'Draft',
      link: 'https://example.org',
      points: 3,
      due: { start: '2026-10-01' },
    });
  });

  it('uses the first of a list and relative dates', () => {
    const filter = where(
      'and',
      { propertyId: 'status', operator: 'isAnyOf', value: ['todo', 'done'] },
      { propertyId: 'tags', operator: 'containsAllOf', value: ['design', 'gone', 'api'] },
      { propertyId: 'due', operator: 'is', value: { kind: 'relative', unit: 'day', amount: 1 } },
      { propertyId: 'done', operator: 'isNotEmpty' },
    );
    expect(newRowDefaults(filter, properties, ctx)).toEqual({
      status: 'todo',
      tags: ['design', 'api'],
      due: { start: '2026-09-24' },
      done: true,
    });
    const anyOf = where('and', {
      propertyId: 'tags',
      operator: 'containsAnyOf',
      value: ['api', 'design'],
    });
    expect(newRowDefaults(anyOf, properties, ctx)).toEqual({ tags: ['api'] });
  });

  it('sets nothing for conditions that allow many values, OR groups or unknown data', () => {
    const loose = where(
      'and',
      { propertyId: 'note', operator: 'contains', value: 'draft' },
      { propertyId: 'note', operator: 'is', value: '   ' },
      { propertyId: 'points', operator: 'gt', value: 3 },
      { propertyId: 'points', operator: 'is', value: Number.NaN },
      { propertyId: 'status', operator: 'is', value: 'deleted-option' },
      { propertyId: 'status', operator: 'isAnyOf', value: [] },
      { propertyId: 'tags', operator: 'containsAllOf', value: ['gone'] },
      { propertyId: 'tags', operator: 'contains', value: 'gone' },
      { propertyId: 'done', operator: 'is', value: false },
      { propertyId: 'owner', operator: 'contains', value: '' },
      { propertyId: 'due', operator: 'isAfter', value: { kind: 'exact', date: '2026-10-01' } },
      { propertyId: 'due', operator: 'is', value: 'not an operand' },
      { propertyId: 'due', operator: 'is', value: { kind: 'range', range: 'thisWeek' } },
      { propertyId: 'due', operator: 'is', value: { kind: 'exact', date: 'nope' } },
      { propertyId: 'created', operator: 'is', value: { kind: 'exact', date: '2026-10-01' } },
      { propertyId: 'missing', operator: 'is', value: 'x' },
    );
    expect(newRowDefaults(loose, properties, ctx)).toEqual({});
    const nested: FilterGroup = {
      type: 'group',
      id: 'root',
      conjunction: 'and',
      children: [where('and', { propertyId: 'status', operator: 'is', value: 'done' })],
    };
    expect(newRowDefaults(nested, properties, ctx)).toEqual({});
    const or = where('or', { propertyId: 'status', operator: 'is', value: 'done' });
    expect(newRowDefaults(or, properties, ctx)).toEqual({});
    expect(newRowDefaults(null, properties, ctx)).toEqual({});
  });

  it("adds the value of the group the row is added in, over the filter's", () => {
    const filter = where('and', { propertyId: 'status', operator: 'is', value: 'todo' });
    expect(newRowDefaults(filter, properties, ctx, { propertyId: 'status', key: 'done' })).toEqual({
      status: 'done',
    });
    const cases: Array<[string, string, unknown]> = [
      ['tags', 'api', ['api']],
      ['done', 'true', true],
      ['points', '5', 5],
      ['note', 'Draft', 'Draft'],
      ['link', 'https://example.org', 'https://example.org'],
      ['due', '2026-10-01', { start: '2026-10-01' }],
    ];
    for (const [propertyId, key, value] of cases) {
      expect(newRowDefaults(null, properties, ctx, { propertyId, key })).toEqual({
        [propertyId]: value,
      });
    }
  });

  it('ignores empty, unknown and unusable groups', () => {
    const unusable: Array<[string, string]> = [
      ['status', EMPTY_GROUP_KEY],
      ['status', 'deleted-option'],
      ['tags', 'deleted-option'],
      ['points', 'many'],
      ['due', '2026-10'],
      ['owner', 'page-ada'],
      ['missing', 'x'],
      // "Unchecked" is the default already.
      ['done', 'false'],
    ];
    for (const [propertyId, key] of unusable) {
      expect(newRowDefaults(null, properties, ctx, { propertyId, key })).toEqual({});
    }
  });
});
