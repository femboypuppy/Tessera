import {
  FILTER_OPERATORS,
  FILTER_OPERATORS_BY_TYPE,
  PROPERTY_TYPES,
  type FilterCondition,
  type FilterGroup,
  type FilterOperator,
  type FilterValue,
  type PropertyDefinition,
} from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { NOW, options, property, row, testContext, titles } from '../test/fixtures';
import {
  compileCondition,
  compileFilter,
  filterRows,
  isConditionActive,
  operatorApplies,
} from './filter';
import type { QueryRow } from './types';

let conditionId = 0;
function cond(propertyId: string, operator: FilterOperator, value?: FilterValue): FilterCondition {
  conditionId += 1;
  const condition: FilterCondition = {
    type: 'condition',
    id: `c${conditionId}`,
    propertyId,
    operator,
  };
  if (value !== undefined) condition.value = value;
  return condition;
}

function group(conjunction: 'and' | 'or', ...children: FilterGroup['children']): FilterGroup {
  conditionId += 1;
  return { type: 'group', id: `g${conditionId}`, conjunction, children };
}

const ctx = testContext();

function run(rows: QueryRow[], props: PropertyDefinition[], filter: FilterGroup, context = ctx) {
  return titles(filterRows(rows, filter, props, context));
}

describe('text operators', () => {
  const name = property('name', 'title');
  const notes = property('notes', 'text');
  const rows = [
    row('Apollo 11', { notes: 'First landing' }),
    row('apollo 13', { notes: '' }),
    row('Gemini', { notes: 'Orbit test' }),
    row('', { notes: '  ' }),
    row('Éclair', {}),
  ];
  const props = [name, notes];
  const only = (...children: FilterGroup['children']) =>
    run(rows, props, group('and', ...children));

  it('matches case-insensitively', () => {
    expect(only(cond('name', 'is', 'APOLLO 11'))).toEqual(['Apollo 11']);
    expect(only(cond('name', 'isNot', 'apollo 11'))).toEqual(['apollo 13', 'Gemini', '', 'Éclair']);
    expect(only(cond('name', 'contains', 'POLL'))).toEqual(['Apollo 11', 'apollo 13']);
    expect(only(cond('name', 'doesNotContain', 'apollo'))).toEqual(['Gemini', '', 'Éclair']);
    expect(only(cond('name', 'startsWith', 'gem'))).toEqual(['Gemini']);
    expect(only(cond('name', 'endsWith', '13'))).toEqual(['apollo 13']);
    expect(only(cond('name', 'is', 'éclair'))).toEqual(['Éclair']);
  });

  it('treats whitespace-only cells as empty', () => {
    expect(only(cond('notes', 'isEmpty'))).toEqual(['apollo 13', '', 'Éclair']);
    expect(only(cond('notes', 'isNotEmpty'))).toEqual(['Apollo 11', 'Gemini']);
    expect(only(cond('name', 'isEmpty'))).toEqual(['']);
    expect(only(cond('notes', 'contains', 'x'))).toEqual([]);
    expect(only(cond('notes', 'doesNotContain', 'orbit'))).toEqual([
      'Apollo 11',
      'apollo 13',
      '',
      'Éclair',
    ]);
  });

  it('ignores conditions without a usable value', () => {
    expect(only(cond('name', 'is'))).toHaveLength(5);
    expect(only(cond('name', 'contains', '   '))).toHaveLength(5);
    expect(only(cond('name', 'contains', 42))).toHaveLength(5);
  });

  it('works for url and email too', () => {
    const url = property('url', 'url');
    const email = property('email', 'email');
    const people = [
      row('A', { url: 'https://nasa.gov', email: 'a@nasa.gov' }),
      row('B', { url: 'http://esa.int' }),
    ];
    expect(run(people, [url, email], group('and', cond('url', 'startsWith', 'HTTPS')))).toEqual([
      'A',
    ]);
    expect(run(people, [url, email], group('and', cond('email', 'isEmpty')))).toEqual(['B']);
    expect(run(people, [url, email], group('and', cond('email', 'endsWith', '.gov')))).toEqual([
      'A',
    ]);
  });
});

describe('number operators', () => {
  const pts = property('pts', 'number');
  const rows = [
    row('a', { pts: 1 }),
    row('b', { pts: 5 }),
    row('c', {}),
    row('d', { pts: 'x' }),
    row('e', { pts: -2.5 }),
  ];
  const only = (condition: FilterCondition) => run(rows, [pts], group('and', condition));

  it('compares numbers and leaves empty cells out', () => {
    expect(only(cond('pts', 'is', 5))).toEqual(['b']);
    expect(only(cond('pts', 'isNot', 5))).toEqual(['a', 'c', 'd', 'e']);
    expect(only(cond('pts', 'gt', 1))).toEqual(['b']);
    expect(only(cond('pts', 'gte', 1))).toEqual(['a', 'b']);
    expect(only(cond('pts', 'lt', 1))).toEqual(['e']);
    expect(only(cond('pts', 'lte', 1))).toEqual(['a', 'e']);
    expect(only(cond('pts', 'isEmpty'))).toEqual(['c', 'd']);
    expect(only(cond('pts', 'isNotEmpty'))).toEqual(['a', 'b', 'e']);
  });

  it('accepts numeric strings and ignores junk operands', () => {
    expect(only(cond('pts', 'gt', '0'))).toEqual(['a', 'b']);
    expect(only(cond('pts', 'gt', 'many'))).toHaveLength(5);
    expect(only(cond('pts', 'gt', Number.NaN))).toHaveLength(5);
    expect(only(cond('pts', 'gt', ''))).toHaveLength(5);
  });
});

describe('select operators', () => {
  const status = property('status', 'select', { options: options(['todo'], ['doing'], ['done']) });
  const rows = [
    row('a', { status: 'todo' }),
    row('b', { status: 'done' }),
    row('c', {}),
    row('d', { status: 'gone' }),
  ];
  const only = (condition: FilterCondition) => run(rows, [status], group('and', condition));

  it('matches options, treating deleted options as empty', () => {
    expect(only(cond('status', 'is', 'todo'))).toEqual(['a']);
    expect(only(cond('status', 'isNot', 'todo'))).toEqual(['b', 'c', 'd']);
    expect(only(cond('status', 'isAnyOf', ['todo', 'done']))).toEqual(['a', 'b']);
    expect(only(cond('status', 'isNoneOf', ['todo', 'done']))).toEqual(['c', 'd']);
    expect(only(cond('status', 'isEmpty'))).toEqual(['c', 'd']);
    expect(only(cond('status', 'isNotEmpty'))).toEqual(['a', 'b']);
  });

  it('ignores missing option lists', () => {
    expect(only(cond('status', 'isAnyOf', []))).toHaveLength(4);
    expect(only(cond('status', 'isAnyOf', 'todo'))).toHaveLength(4);
    expect(only(cond('status', 'is', ['todo']))).toHaveLength(4);
  });
});

describe('multi-select and relation operators', () => {
  const tags = property('tags', 'multiSelect', { options: options(['red'], ['green'], ['blue']) });
  const links = property('links', 'relation');
  const rows = [
    row('a', { tags: ['red', 'green'], links: ['p1', 'p2'] }),
    row('b', { tags: ['blue'], links: ['p3'] }),
    row('c', { tags: [] }),
    row('d', { tags: ['ghost'], links: ['trashed'] }),
  ];
  const props = [tags, links];
  const visibleCtx = testContext({ isPageVisible: (id) => id !== 'trashed' });
  const only = (condition: FilterCondition) =>
    run(rows, props, group('and', condition), visibleCtx);

  it('matches contained options', () => {
    expect(only(cond('tags', 'contains', 'red'))).toEqual(['a']);
    expect(only(cond('tags', 'doesNotContain', 'red'))).toEqual(['b', 'c', 'd']);
    expect(only(cond('tags', 'containsAnyOf', ['red', 'blue']))).toEqual(['a', 'b']);
    expect(only(cond('tags', 'containsAllOf', ['red', 'green']))).toEqual(['a']);
    expect(only(cond('tags', 'containsNoneOf', ['red', 'blue']))).toEqual(['c', 'd']);
    expect(only(cond('tags', 'isEmpty'))).toEqual(['c', 'd']);
    expect(only(cond('tags', 'isNotEmpty'))).toEqual(['a', 'b']);
    expect(only(cond('tags', 'contains', ''))).toHaveLength(4);
    expect(only(cond('tags', 'containsAllOf', []))).toHaveLength(4);
  });

  it('matches relations and hides invisible pages', () => {
    expect(only(cond('links', 'contains', 'p3'))).toEqual(['b']);
    expect(only(cond('links', 'doesNotContain', 'p1'))).toEqual(['b', 'c', 'd']);
    expect(only(cond('links', 'isEmpty'))).toEqual(['c', 'd']);
    expect(only(cond('links', 'contains', 'trashed'))).toEqual([]);
    expect(run(rows, props, group('and', cond('links', 'contains', 'trashed')))).toEqual(['d']);
  });
});

describe('date operators', () => {
  const due = property('due', 'date');
  const rows = [
    row('yesterday', { due: { start: '2026-09-22' } }),
    row('today', { due: { start: '2026-09-23' } }),
    row('tomorrow', { due: { start: '2026-09-24' } }),
    row('week', { due: { start: '2026-09-21', end: '2026-09-27' } }),
    row('late-utc', { due: { start: '2026-09-23T23:30:00.000Z', includeTime: true } }),
    row('none', {}),
    row('bad', { due: { start: '2026-02-30' } }),
  ];
  const only = (condition: FilterCondition, context = ctx) =>
    run(rows, [due], group('and', condition), context);
  const exact = (date: string) => ({ kind: 'exact' as const, date });

  it('compares calendar days; ranges overlap for is and compare by start otherwise', () => {
    expect(only(cond('due', 'is', exact('2026-09-23')))).toEqual(['today', 'week', 'late-utc']);
    expect(only(cond('due', 'isBefore', exact('2026-09-23')))).toEqual(['yesterday', 'week']);
    expect(only(cond('due', 'isAfter', exact('2026-09-23')))).toEqual(['tomorrow']);
    expect(only(cond('due', 'isOnOrBefore', exact('2026-09-23')))).toEqual([
      'yesterday',
      'today',
      'week',
      'late-utc',
    ]);
    expect(only(cond('due', 'isOnOrAfter', exact('2026-09-23')))).toEqual([
      'today',
      'tomorrow',
      'late-utc',
    ]);
    expect(only(cond('due', 'isEmpty'))).toEqual(['none', 'bad']);
    expect(only(cond('due', 'isNotEmpty'))).toHaveLength(5);
  });

  it('uses the viewer time zone for values with a time', () => {
    const tokyo = testContext({ timeZone: 'Asia/Tokyo' });
    // 23:30 UTC on the 23rd is the 24th in Tokyo.
    expect(only(cond('due', 'is', exact('2026-09-24')), tokyo)).toEqual([
      'tomorrow',
      'week',
      'late-utc',
    ]);
    expect(only(cond('due', 'isAfter', exact('2026-09-23')), tokyo)).toEqual([
      'tomorrow',
      'late-utc',
    ]);
    expect(only(cond('due', 'isBefore', exact('2026-09-24')), tokyo)).toEqual([
      'yesterday',
      'today',
      'week',
    ]);
    expect(only(cond('due', 'isOnOrAfter', exact('2026-09-24')), tokyo)).toEqual([
      'tomorrow',
      'late-utc',
    ]);
  });

  it('supports relative days and ranges', () => {
    expect(only(cond('due', 'is', { kind: 'relative', unit: 'day', amount: 1 }))).toEqual([
      'tomorrow',
      'week',
    ]);
    expect(only(cond('due', 'isWithin', { kind: 'range', range: 'past7Days' }))).toEqual([
      'yesterday',
      'today',
      'week',
      'late-utc',
    ]);
    expect(only(cond('due', 'isWithin', { kind: 'range', range: 'nextWeek' }))).toEqual([]);
    expect(
      only(cond('due', 'isWithin', { kind: 'between', start: '2026-09-24', end: '2026-09-30' })),
    ).toEqual(['tomorrow', 'week']);
    expect(only(cond('due', 'isWithin', { kind: 'exact', date: '2026-09-22' }))).toEqual([
      'yesterday',
      'week',
    ]);
  });

  it('follows "now" in the context', () => {
    const later = testContext({ now: NOW + 2 * 86_400_000 });
    expect(only(cond('due', 'is', { kind: 'relative', unit: 'day', amount: -1 }), later)).toEqual([
      'tomorrow',
      'week',
    ]);
  });

  it('ignores malformed operands', () => {
    expect(only(cond('due', 'is', 'today'))).toHaveLength(7);
    expect(only(cond('due', 'is', { kind: 'exact', date: 'soon' }))).toHaveLength(7);
    expect(
      only(cond('due', 'is', { kind: 'relative', unit: 'decade', amount: 1 } as never)),
    ).toHaveLength(7);
    expect(
      only(cond('due', 'is', { kind: 'relative', unit: 'day', amount: Infinity })),
    ).toHaveLength(7);
    expect(
      only(cond('due', 'isWithin', { kind: 'range', range: 'someday' } as never)),
    ).toHaveLength(7);
    expect(
      only(cond('due', 'isWithin', { kind: 'between', start: '2026-09-24' } as never)),
    ).toHaveLength(7);
    expect(only(cond('due', 'isWithin', { kind: 'other' } as never))).toHaveLength(7);
  });

  it('filters created and updated times as instants', () => {
    const created = property('created', 'createdTime');
    const updated = property('updated', 'updatedTime');
    const times = [
      row('old', {}, { createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 8, 23, 5) }),
      row('new', {}, { createdAt: Date.UTC(2026, 8, 23, 1), updatedAt: Date.UTC(2026, 8, 23, 1) }),
    ];
    const props = [created, updated];
    expect(
      run(
        times,
        props,
        group('and', cond('created', 'is', { kind: 'relative', unit: 'day', amount: 0 })),
      ),
    ).toEqual(['new']);
    expect(
      run(
        times,
        props,
        group('and', cond('created', 'isWithin', { kind: 'range', range: 'thisYear' })),
      ),
    ).toEqual(['old', 'new']);
    expect(
      run(
        times,
        props,
        group('and', cond('updated', 'isAfter', { kind: 'exact', date: '2026-09-22' })),
      ),
    ).toEqual(['old', 'new']);
    expect(run(times, props, group('and', cond('created', 'isEmpty')))).toEqual([]);
    // In New York, 01:00 UTC on the 23rd is still the 22nd.
    const ny = testContext({ timeZone: 'America/New_York' });
    expect(
      run(
        times,
        props,
        group('and', cond('created', 'is', { kind: 'exact', date: '2026-09-22' })),
        ny,
      ),
    ).toEqual(['new']);
  });
});

describe('checkbox and formula operators', () => {
  const done = property('done', 'checkbox');
  const formula = property('f', 'formula');
  const rows = [row('yes', { done: true }), row('no', { done: false }), row('missing', {})];

  it('treats a missing checkbox as unchecked', () => {
    expect(run(rows, [done], group('and', cond('done', 'is', true)))).toEqual(['yes']);
    expect(run(rows, [done], group('and', cond('done', 'is', false)))).toEqual(['no', 'missing']);
    expect(run(rows, [done], group('and', cond('done', 'isEmpty')))).toEqual(['no', 'missing']);
    expect(run(rows, [done], group('and', cond('done', 'isNotEmpty')))).toEqual(['yes']);
    expect(run(rows, [done], group('and', cond('done', 'is', 'true')))).toHaveLength(3);
  });

  it('treats a formula without an expression as empty', () => {
    // Formula results are covered in formula/rows.test.ts.
    expect(run(rows, [formula], group('and', cond('f', 'isEmpty')))).toHaveLength(3);
    expect(run(rows, [formula], group('and', cond('f', 'isNotEmpty')))).toHaveLength(0);
    expect(run(rows, [formula], group('and', cond('f', 'is', 'x')))).toHaveLength(0);
    expect(run(rows, [formula], group('and', cond('f', 'isNot', 'x')))).toHaveLength(3);
  });
});

describe('groups and activity', () => {
  const name = property('name', 'title');
  const pts = property('pts', 'number');
  const rows = [row('a', { pts: 1 }), row('b', { pts: 2 }), row('c', { pts: 3 })];
  const props = [name, pts];

  it('nests AND and OR groups', () => {
    const filter = group(
      'or',
      cond('pts', 'is', 1),
      group('and', cond('pts', 'gt', 1), cond('name', 'isNot', 'b')),
    );
    expect(run(rows, props, filter)).toEqual(['a', 'c']);
    expect(run(rows, props, group('and', cond('pts', 'gt', 1), cond('name', 'is', 'b')))).toEqual([
      'b',
    ]);
  });

  it('ignores inactive conditions instead of matching everything inside OR groups', () => {
    const filter = group('or', cond('pts', 'is', 1), cond('name', 'is'));
    expect(run(rows, props, filter)).toEqual(['a']);
    expect(compileFilter(group('and', cond('name', 'is')), props, ctx)).toBeNull();
    expect(compileFilter(group('or'), props, ctx)).toBeNull();
    expect(compileFilter(null, props, ctx)).toBeNull();
    expect(filterRows(rows, null, props, ctx)).toBe(rows);
  });

  it('ignores deleted properties and operators that no longer apply', () => {
    expect(run(rows, props, group('and', cond('ghost', 'is', 'x')))).toHaveLength(3);
    expect(run(rows, props, group('and', cond('pts', 'contains', '1')))).toHaveLength(3);
    expect(isConditionActive(cond('pts', 'contains', '1'), props, ctx)).toBe(false);
    expect(isConditionActive(cond('pts', 'gt', 1), props, ctx)).toBe(true);
    expect(compileCondition(cond('pts', 'gt', 1), undefined, ctx)).toBeNull();
  });

  it('survives malformed trees', () => {
    const broken = {
      type: 'group',
      id: 'x',
      conjunction: 'and',
      children: 'nope',
    } as unknown as FilterGroup;
    expect(compileFilter(broken, props, ctx)).toBeNull();
    let deep: FilterGroup = group('and', cond('pts', 'is', 1));
    for (let i = 0; i < 40; i += 1) deep = group('and', deep);
    expect(compileFilter(deep, props, ctx)).toBeNull();
  });

  it('knows which operators apply to each type', () => {
    for (const type of PROPERTY_TYPES) {
      const prop = property(`p-${type}`, type);
      for (const operator of FILTER_OPERATORS) {
        const expected =
          operator === 'isEmpty' ||
          operator === 'isNotEmpty' ||
          FILTER_OPERATORS_BY_TYPE[type].includes(operator);
        expect(operatorApplies(prop, operator)).toBe(expected);
      }
    }
  });
});
