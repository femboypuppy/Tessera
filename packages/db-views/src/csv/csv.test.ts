import { listProperties, listRows } from '@tessera/core';
import { createTestAppContext } from '@tessera/core/testing';
import { describe, expect, it } from 'vitest';
import { importCsvAsDatabase } from '../model/csv-import';
import { options, property, row, testContext } from '../test/fixtures';
import {
  columnOptions,
  csvFileName,
  inferColumn,
  inferColumns,
  parseCsv,
  rowsToCsv,
  titleColumnIndex,
} from './csv';

const ctx = testContext();

describe('parseCsv', () => {
  it('reads quoted fields, a byte order mark and ragged rows', () => {
    const table = parseCsv(
      '\uFEFFName,Notes,,Name\n"Dune","A ""classic"", really"\nPiranesi,,x,y,extra\n\n',
    );
    expect(table.headers).toEqual(['Name', 'Notes', 'Column 3', 'Name (2)', 'Column 5']);
    expect(table.rows).toEqual([
      ['Dune', 'A "classic", really', '', '', ''],
      ['Piranesi', '', 'x', 'y', 'extra'],
    ]);
  });

  it('detects other delimiters and handles empty files', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([['1', '2']]);
    expect(parseCsv('a\tb\n1\t2').headers).toEqual(['a', 'b']);
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('type inference', () => {
  const infer = (values: string[]) => inferColumn('Column', 1, values, ctx);

  it('recognizes checkboxes, numbers, percents and currencies', () => {
    expect(infer(['yes', 'no', 'Yes', ''])).toMatchObject({ type: 'checkbox' });
    expect(infer(['1', '2,500', '-3.5'])).toMatchObject({ type: 'number' });
    expect(infer(['90%', '12.5%'])).toMatchObject({
      type: 'number',
      number: { format: 'percent' },
    });
    expect(infer(['$9.99', '$1,200'])).toMatchObject({
      type: 'number',
      number: { format: 'currency', currency: 'USD' },
    });
    // Mixed currencies stay plain numbers.
    expect(infer(['$9.99', '€5'])).toEqual({ index: 1, name: 'Column', type: 'number' });
  });

  it('recognizes dates, day-first dates, URLs and emails', () => {
    expect(infer(['2026-09-23', '2026-10-01 → 2026-10-03'])).toMatchObject({ type: 'date' });
    expect(infer(['23/09/2026', '01/10/2026'])).toMatchObject({ type: 'date', dayFirst: true });
    expect(infer(['https://example.org', 'www.tessera.dev'])).toMatchObject({ type: 'url' });
    expect(infer(['ada@example.org'])).toMatchObject({ type: 'email' });
  });

  it('recognizes selects and multi-selects from repeated short values', () => {
    expect(infer(['Done', 'Reading', 'Done', 'To read', 'Reading'])).toMatchObject({
      type: 'select',
      options: ['Done', 'Reading', 'To read'],
    });
    expect(infer(['Fantasy, Classic', 'Fantasy', 'Myth, fantasy'])).toMatchObject({
      type: 'multiSelect',
      options: ['Fantasy', 'Classic', 'Myth'],
    });
    // A few short values in a small file are a select even without repeats.
    expect(infer(['High', 'Low'])).toMatchObject({ type: 'select' });
  });

  it('falls back to text', () => {
    expect(infer([])).toMatchObject({ type: 'text' });
    const sentences = Array.from({ length: 10 }, (_, index) => `A sentence number ${index}`);
    expect(infer(sentences)).toMatchObject({ type: 'text' });
    expect(
      infer(['A long, winding note that goes on', 'Another, different, thought']),
    ).toMatchObject({
      type: 'text',
    });
  });

  it('picks the title column by name, else the first', () => {
    expect(titleColumnIndex(['Author', 'Title', 'Pages'])).toBe(1);
    expect(titleColumnIndex(['Author', 'Pages'])).toBe(0);
    const table = parseCsv('Author,Task\nAda,Write the brief');
    expect(inferColumns(table, ctx).map((plan) => plan.type)).toEqual(['select', 'title']);
  });

  it('lists options for a column whose type was changed', () => {
    const table = parseCsv('Name,Tags\nA,"ui, api"\nB,"api"');
    expect(columnOptions(table, { index: 1, name: 'Tags', type: 'multiSelect' })).toEqual([
      'ui',
      'api',
    ]);
    expect(columnOptions(table, { index: 1, name: 'Tags', type: 'select' })).toEqual([
      'ui, api',
      'api',
    ]);
    expect(columnOptions(table, { index: 1, name: 'Tags', type: 'text' })).toEqual([]);
  });
});

describe('export', () => {
  it('names files safely', () => {
    expect(csvFileName('Reading list', 'Table')).toBe('Reading list - Table.csv');
    expect(csvFileName('Q3: plans/ideas?', 'Board')).toBe('Q3 plans ideas - Board.csv');
    expect(csvFileName('', '')).toBe('-.csv');
    expect(csvFileName('x'.repeat(200), 'View')).toHaveLength(124);
  });

  it('writes the rows as plain text in view order', () => {
    const status = property('status', 'select', { name: 'Status', options: options(['done']) });
    const pages = property('pages', 'number', { name: 'Pages' });
    const finished = property('finished', 'date', { name: 'Finished' });
    const owned = property('owned', 'checkbox', { name: 'Owned' });
    const title = property('title', 'title', { name: 'Name' });
    const csv = rowsToCsv(
      [
        row('Dune, the novel', {
          status: 'done',
          pages: 688,
          finished: { start: '2026-01-14' },
          owned: true,
        }),
        row('Piranesi', {}),
      ],
      [title, status, pages, finished, owned],
      ctx,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Name,Status,Pages,Finished,Owned',
      '"Dune, the novel",Done,688,2026-01-14,Yes',
      'Piranesi,,,,No',
    ]);
  });
});

describe('importCsvAsDatabase', () => {
  it('creates a typed database with every row', async () => {
    const test = await createTestAppContext();
    try {
      const table = parseCsv(
        'Title,Status,Pages,Finished,Owned\nDune,Done,688,2026-01-14,yes\nPiranesi,Reading,272,,no\nCirce,Done,not a number,2026-05-21,yes',
      );
      const plans = inferColumns(table, ctx);
      const { page, rowCount } = await importCsvAsDatabase(
        test.ctx,
        table,
        plans,
        { title: 'Books' },
        ctx,
      );
      expect(rowCount).toBe(3);
      expect(page.title).toBe('Books');
      const handle = await test.ctx.loadDatabaseDoc(page.id);
      try {
        const properties = listProperties(handle.doc);
        expect(properties.map((entry) => [entry.name, entry.type])).toEqual([
          ['Title', 'title'],
          ['Status', 'select'],
          ['Pages', 'text'],
          ['Finished', 'date'],
          ['Owned', 'checkbox'],
        ]);
        const status = properties[1];
        const finished = properties[3];
        const owned = properties[4];
        const rows = listRows(handle.doc);
        expect(rows.map((entry) => test.ctx.workspace.getPage(entry.id)?.title)).toEqual([
          'Dune',
          'Piranesi',
          'Circe',
        ]);
        const done = status?.options?.find((option) => option.name === 'Done');
        expect(rows[0]?.values[status?.id ?? '']).toBe(done?.id);
        expect(rows[0]?.values[finished?.id ?? '']).toEqual({ start: '2026-01-14' });
        expect(rows[0]?.values[owned?.id ?? '']).toBe(true);
        expect(rows[1]?.values[owned?.id ?? '']).toBe(false);
        // "not a number" in a number-looking column: the column stays text, nothing is lost.
        expect(rows[2]?.values[properties[2]?.id ?? '']).toBe('not a number');
      } finally {
        handle.release();
      }
    } finally {
      await test.dispose();
    }
  });
});
