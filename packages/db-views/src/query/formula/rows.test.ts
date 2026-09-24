import type { FilterGroup, PropertyDefinition, ViewConfig } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { property, row, testContext, titles } from '../../test/fixtures';
import { readCell } from '../cells';
import { cellToText } from '../format';
import { runQuery } from '../run';
import { computeSummary } from '../summary';
import type { QueryRow } from '../types';
import { previewFormula, renamePropertyInFormula, withFormulaValues } from './index';

const ctx = testContext();
const pages = property('pages', 'number', { name: 'Pages' });
const finished = property('finished', 'date', { name: 'Finished' });
const perDay = property('perDay', 'formula', {
  name: 'Per day',
  formula: { expression: 'round(prop("Pages") / 30, 1)' },
});
const label = property('label', 'formula', {
  name: 'Label',
  formula: { expression: 'if(prop("Pages") > 400, "Long", "Short")' },
});
const long = property('long', 'formula', {
  name: 'Is long',
  formula: { expression: 'prop("Pages") > 400' },
});
const due = property('due', 'formula', {
  name: 'Due',
  formula: { expression: 'dateAdd(prop("Finished"), 7, "days")' },
});
const PROPERTIES: PropertyDefinition[] = [pages, finished, perDay, label, long, due];

const ROWS: QueryRow[] = [
  row('Dune', { pages: 688, finished: { start: '2026-01-14' } }),
  row('Piranesi', { pages: 272, finished: { start: '2026-02-20' } }),
  row('Circe', { pages: 393 }),
  row('Notes', {}),
];

type QueryView = Pick<ViewConfig, 'filter' | 'sorts' | 'group'>;
const view = (patch: Partial<QueryView> = {}): QueryView => ({
  filter: null,
  sorts: [],
  group: null,
  ...patch,
});

function where(
  propertyId: string,
  operator: string,
  value?: string | number | boolean,
): FilterGroup {
  return {
    type: 'group',
    id: 'root',
    conjunction: 'and',
    children: [
      {
        type: 'condition',
        id: 'c1',
        propertyId,
        operator: operator as never,
        ...(value === undefined ? {} : { value }),
      },
    ],
  };
}

describe('withFormulaValues', () => {
  it('computes every formula of every row', () => {
    const [dune, , circe, notes] = withFormulaValues(ROWS, PROPERTIES, ctx);
    expect(dune?.formulas).toEqual({
      perDay: 22.9,
      label: 'Long',
      long: true,
      due: { start: '2026-01-21' },
    });
    // Empty results are left out; errors leave the cell empty too.
    expect(circe?.formulas).toEqual({ perDay: 13.1, label: 'Short', long: false });
    // Comparing an empty value gives an empty result (not false).
    expect(notes?.formulas).toEqual({ label: 'Short' });
    expect(readCell(dune as QueryRow, perDay)).toBe(22.9);
    expect(readCell(notes as QueryRow, perDay)).toBeNull();
  });

  it('keeps rows as they are without formulas, and skips formulas that do not compile', () => {
    expect(withFormulaValues(ROWS, [pages], ctx)).toBe(ROWS);
    const broken = property('broken', 'formula', {
      name: 'Broken',
      formula: { expression: '1 +' },
    });
    const [first] = withFormulaValues(ROWS, [pages, broken], ctx);
    expect(first?.formulas).toEqual({});
    const empty = property('empty', 'formula', { name: 'Empty' });
    expect(withFormulaValues(ROWS, [pages, empty], ctx)[0]?.formulas).toEqual({});
  });

  it('keeps row identity while nothing a formula reads changes', () => {
    const first = withFormulaValues(ROWS, PROPERTIES, ctx);
    const again = withFormulaValues(ROWS, PROPERTIES, testContext({ now: ctx.now + 3_600_000 }));
    expect(again[0]).toBe(first[0]);
    // A changed row object is recomputed; the others stay.
    const changed = [{ ...ROWS[0], values: { pages: 100 } } as QueryRow, ...ROWS.slice(1)];
    const next = withFormulaValues(changed, PROPERTIES, ctx);
    expect(next[0]?.formulas?.perDay).toBe(3.3);
    expect(next[1]).toBe(first[1]);
    // So is every row when a formula changes.
    const edited = PROPERTIES.map((entry) =>
      entry.id === 'perDay' ? { ...entry, formula: { expression: 'prop("Pages")' } } : entry,
    );
    expect(withFormulaValues(ROWS, edited, ctx)[1]?.formulas?.perDay).toBe(272);
  });

  it('recomputes clock formulas each minute and relation formulas every time', () => {
    const age = property('age', 'formula', {
      name: 'Age',
      formula: { expression: 'dateBetween(now(), prop("Finished"), "minutes")' },
    });
    const first = withFormulaValues(ROWS, [finished, age], ctx);
    expect(withFormulaValues(ROWS, [finished, age], ctx)[0]).toBe(first[0]);
    const later = withFormulaValues(ROWS, [finished, age], testContext({ now: ctx.now + 60_000 }));
    expect(later[0]).not.toBe(first[0]);
    expect(Number(later[0]?.formulas?.age) - Number(first[0]?.formulas?.age)).toBe(1);

    const related = property('related', 'relation', { name: 'Related' });
    const who = property('who', 'formula', {
      name: 'Who',
      formula: { expression: 'prop("Related")' },
    });
    // Through another formula too.
    const via = property('via', 'formula', { name: 'Via', formula: { expression: 'prop("Who")' } });
    const rows = [row('Task', { related: ['ada'] })];
    let name = 'Ada';
    const people = testContext({ titleOf: () => name });
    const before = withFormulaValues(rows, [related, via, who], people);
    name = 'Ada Lovelace';
    const after = withFormulaValues(rows, [related, via, who], people);
    expect(before[0]?.formulas?.via).toBe('Ada');
    expect(after[0]?.formulas?.via).toBe('Ada Lovelace');
  });
});

describe('formulas in views', () => {
  it('filters by numbers, text, checkboxes and dates', () => {
    const run = (filter: FilterGroup) =>
      titles(runQuery(ROWS, PROPERTIES, view({ filter }), ctx).rows);
    expect(run(where('perDay', 'gt', 10))).toEqual(['Dune', 'Circe']);
    expect(run(where('perDay', 'lte', '13.1'))).toEqual(['Piranesi', 'Circe']);
    expect(run(where('perDay', 'is', 22.9))).toEqual(['Dune']);
    expect(run(where('perDay', 'isNot', 22.9))).toEqual(['Piranesi', 'Circe', 'Notes']);
    expect(run(where('perDay', 'isEmpty'))).toEqual(['Notes']);
    expect(run(where('perDay', 'isNotEmpty'))).toEqual(['Dune', 'Piranesi', 'Circe']);
    expect(run(where('label', 'is', 'long'))).toEqual(['Dune']);
    expect(run(where('label', 'contains', 'ORT'))).toEqual(['Piranesi', 'Circe', 'Notes']);
    expect(run(where('label', 'doesNotContain', 'ort'))).toEqual(['Dune']);
    expect(run(where('label', 'lt', 'M'))).toEqual(['Dune']);
    expect(run(where('long', 'is', true))).toEqual(['Dune']);
    expect(run(where('long', 'is', 'no'))).toEqual(['Piranesi', 'Circe']);
    expect(run(where('long', 'contains', 'tru'))).toEqual(['Dune']);
    expect(run(where('long', 'gt', 0))).toEqual([]);
    expect(run(where('due', 'is', '2026-01-21'))).toEqual(['Dune']);
    expect(run(where('due', 'gt', 'Jan 30, 2026'))).toEqual(['Piranesi']);
    expect(run(where('due', 'lt', 'soon'))).toEqual([]);
    expect(run(where('due', 'contains', '2026-02'))).toEqual(['Piranesi']);
    expect(run(where('due', 'isNotEmpty'))).toEqual(['Dune', 'Piranesi']);
    // Conditions without a value, or with an operator formulas don't have, are inactive.
    expect(run(where('perDay', 'gt', ''))).toEqual(titles(ROWS));
    expect(run(where('perDay', 'startsWith', 'x'))).toEqual(titles(ROWS));
  });

  it('sorts and searches by results, and sums them', () => {
    const sorted = runQuery(
      ROWS,
      PROPERTIES,
      view({ sorts: [{ propertyId: 'perDay', direction: 'desc' }] }),
      ctx,
    );
    expect(titles(sorted.rows)).toEqual(['Dune', 'Circe', 'Piranesi', 'Notes']);
    const byLabel = runQuery(
      ROWS,
      PROPERTIES,
      view({ sorts: [{ propertyId: 'label', direction: 'asc' }] }),
      ctx,
    );
    expect(titles(byLabel.rows)).toEqual(['Dune', 'Piranesi', 'Circe', 'Notes']);
    const byLong = runQuery(
      ROWS,
      PROPERTIES,
      view({ sorts: [{ propertyId: 'long', direction: 'desc' }] }),
      ctx,
    );
    expect(titles(byLong.rows)[0]).toBe('Dune');
    const byDue = runQuery(
      ROWS,
      PROPERTIES,
      view({ sorts: [{ propertyId: 'due', direction: 'desc' }] }),
      ctx,
    );
    expect(titles(byDue.rows)).toEqual(['Piranesi', 'Dune', 'Circe', 'Notes']);
    const timed = property('timed', 'formula', {
      name: 'Timed',
      formula: { expression: 'dateAdd(prop("Finished"), 1, "hour")' },
    });
    const byTime = runQuery(
      ROWS,
      [...PROPERTIES, timed],
      view({ sorts: [{ propertyId: 'timed', direction: 'asc' }] }),
      ctx,
    );
    expect(titles(byTime.rows).slice(0, 2)).toEqual(['Dune', 'Piranesi']);
    const blank = property('blank', 'formula', { name: 'Blank', formula: { expression: '""' } });
    const byBlank = runQuery(
      ROWS,
      [...PROPERTIES, blank],
      view({ sorts: [{ propertyId: 'blank', direction: 'asc' }] }),
      ctx,
    );
    expect(titles(byBlank.rows)).toEqual(titles(ROWS));

    const found = runQuery(ROWS, PROPERTIES, view(), ctx, { search: 'long' });
    expect(titles(found.rows)).toEqual(['Dune']);

    const { rows } = runQuery(ROWS, PROPERTIES, view(), ctx);
    const sum = computeSummary('sum', rows, perDay, ctx);
    expect(sum.type === 'number' ? sum.value : null).toBeCloseTo(45.1, 10);
    expect(computeSummary('countNotEmpty', rows, label, ctx)).toEqual({ type: 'count', value: 4 });
  });

  it('writes results as plain text', () => {
    const [dune] = runQuery(ROWS, PROPERTIES, view(), ctx).rows;
    if (!dune) throw new Error('no rows');
    expect(cellToText(readCell(dune, perDay), perDay, ctx)).toBe('22.9');
    expect(cellToText(readCell(dune, label), label, ctx)).toBe('Long');
    expect(cellToText(readCell(dune, long), long, ctx)).toBe('Yes');
    expect(cellToText(false, long, ctx)).toBe('No');
    expect(cellToText(readCell(dune, due), due, ctx)).toBe('2026-01-21');
    expect(cellToText(null, due, ctx)).toBe('');
    // Anything else in `formulas` reads as empty.
    expect(readCell({ ...dune, formulas: { due: ['x'] } }, due)).toBeNull();
  });
});

describe('previewFormula', () => {
  it('evaluates a draft for the first rows, or reports why it does not compile', () => {
    const preview = previewFormula('prop("Pages") * 2', 'perDay', PROPERTIES, ROWS, ctx, 2);
    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    expect(preview.results.map(({ row: entry, outcome }) => [entry.title, outcome])).toEqual([
      ['Dune', { value: 1376 }],
      ['Piranesi', { value: 544 }],
    ]);
    expect(previewFormula('prop("Pages") /', 'perDay', PROPERTIES, ROWS, ctx)).toMatchObject({
      ok: false,
      error: { code: 'unexpectedEnd' },
    });
    const failing = previewFormula('prop("Pages") / 0', 'perDay', PROPERTIES, ROWS, ctx, 1);
    expect(failing).toMatchObject({
      ok: true,
      results: [{ outcome: { error: { code: 'divisionByZero' } } }],
    });
  });
});

describe('renamePropertyInFormula', () => {
  it('rewrites references to the renamed property only', () => {
    expect(renamePropertyInFormula('prop("Pages") / 30', 'Pages', 'Page count')).toBe(
      'prop("Page count") / 30',
    );
    expect(
      renamePropertyInFormula(
        `PROP( 'pages' ) + prop("Pages Read") + "prop(\\"Pages\\")"`,
        'Pages',
        'Say "hi"',
      ),
    ).toBe(`PROP( "Say \\"hi\\"" ) + prop("Pages Read") + "prop(\\"Pages\\")"`);
    expect(renamePropertyInFormula('prop("Pages"', 'Pages', 'X')).toBe('prop("Pages"');
    expect(renamePropertyInFormula('"unterminated', 'Pages', 'X')).toBe('"unterminated');
  });
});
