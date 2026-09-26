import { describe, expect, it } from 'vitest';
import {
  inferColumn,
  parseCheckboxCell,
  parseCsv,
  parseDateCell,
  parseNumberCell,
  parseRelationCell,
  writeCsv,
} from './csv';

describe('CSV', () => {
  it('parses quoted fields, a BOM and uneven rows, and names empty or duplicate headers', () => {
    expect(
      parseCsv('\uFEFFName,Notes,Notes,\n"Dune","Spice, sand\nand ""politics""",x\nShort\n'),
    ).toEqual({
      headers: ['Name', 'Notes', 'Notes (2)', 'Column 4'],
      rows: [
        ['Dune', 'Spice, sand\nand "politics"', 'x', ''],
        ['Short', '', '', ''],
      ],
    });
  });

  it('writes CSV that reads back the same', () => {
    const text = writeCsv(
      ['Name', 'Tags'],
      [
        ['Dune', 'sci-fi, classic'],
        ['Quote "x"', ''],
      ],
    );
    expect(parseCsv(text)).toEqual({
      headers: ['Name', 'Tags'],
      rows: [
        ['Dune', 'sci-fi, classic'],
        ['Quote "x"', ''],
      ],
    });
  });
});

describe('cells', () => {
  it('parses dates in Notion, ISO, slashed and dotted forms, with times and ranges', () => {
    expect(parseDateCell('September 23, 2026')).toEqual({ start: '2026-09-23' });
    expect(parseDateCell('Sep 23, 2026 3:30 PM')).toEqual({
      start: '2026-09-23T15:30:00.000Z',
      includeTime: true,
    });
    expect(parseDateCell('2026-09-23T08:15:00+02:00')).toEqual({
      start: '2026-09-23T06:15:00.000Z',
      includeTime: true,
    });
    expect(parseDateCell('2026/9/3')).toEqual({ start: '2026-09-03' });
    expect(parseDateCell('09/03/2026')).toEqual({ start: '2026-09-03' });
    expect(parseDateCell('23/09/2026')).toEqual({ start: '2026-09-23' });
    expect(parseDateCell('23.09.2026')).toEqual({ start: '2026-09-23' });
    expect(parseDateCell('23 September 2026')).toEqual({ start: '2026-09-23' });
    expect(parseDateCell('September 25, 2026 → September 26, 2026')).toEqual({
      start: '2026-09-25',
      end: '2026-09-26',
    });
    for (const bad of [
      'February 30, 2026',
      '2026-13-01',
      'soon',
      '12',
      'September 26, 2026 → September 25, 2026',
    ])
      expect(parseDateCell(bad)).toBeNull();
  });

  it('parses numbers with separators, currencies and percents', () => {
    expect(parseNumberCell('1,234.5')).toEqual({
      value: 1234.5,
      percent: false,
      currency: null,
      decimals: 1,
    });
    expect(parseNumberCell('$1,200.00')).toEqual({
      value: 1200,
      percent: false,
      currency: 'USD',
      decimals: 2,
    });
    expect(parseNumberCell('€9.99')).toMatchObject({ value: 9.99, currency: 'EUR' });
    expect(parseNumberCell('45%')).toMatchObject({ value: 0.45, percent: true, currency: null });
    expect(parseNumberCell('-3')).toMatchObject({ value: -3 });
    expect(parseNumberCell('12 GBP')).toMatchObject({ value: 12, currency: 'GBP' });
    for (const bad of ['1.2.3', 'abc', '1,23', '']) expect(parseNumberCell(bad)).toBeNull();
    expect(parseNumberCell('7.')).toMatchObject({ value: 7 });
    expect(parseNumberCell('.5e2')).toMatchObject({ value: 50 });
  });

  it('rejects a long, hostile cell in linear time', () => {
    // `0000…0x` took minutes at 10,000 to 40,000 characters with `\d+\.?\d*`.
    const started = performance.now();
    expect(parseNumberCell(`${'0'.repeat(50_000)}x`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('parses checkboxes and relations', () => {
    expect(['Yes', 'no', 'TRUE', '✅'].map(parseCheckboxCell)).toEqual([true, false, true, true]);
    expect(parseCheckboxCell('maybe')).toBeNull();
    expect(
      parseRelationCell(
        'Neil (https://www.notion.so/Neil-a3b4c5d6e7f80112233445566778899a), Buzz (../Crew/Buzz%20Aldrin.md)',
      ),
    ).toEqual([
      { title: 'Neil', target: 'https://www.notion.so/Neil-a3b4c5d6e7f80112233445566778899a' },
      { title: 'Buzz', target: '../Crew/Buzz%20Aldrin.md' },
    ]);
    expect(parseRelationCell('Just text (with a note)')).toBeNull();
  });
});

describe('column types', () => {
  it('infers each property type from the values', () => {
    expect(inferColumn('Done', ['Yes', 'No', '']).type).toBe('checkbox');
    expect(inferColumn('Rating', ['4.5', '5', '3'])).toEqual({
      name: 'Rating',
      type: 'number',
      number: { format: 'plain', precision: 1 },
    });
    expect(inferColumn('Budget', ['$10.00', '$1,200.00'])).toEqual({
      name: 'Budget',
      type: 'number',
      number: { format: 'currency', currency: 'USD', precision: 2 },
    });
    expect(inferColumn('Progress', ['10%', '100%']).number).toEqual({
      format: 'percent',
      precision: 0,
    });
    expect(inferColumn('Due', ['September 23, 2026', '2026-10-01']).type).toBe('date');
    expect(inferColumn('Created time', ['September 20, 2026 3:30 PM']).type).toBe('createdTime');
    expect(inferColumn('Last edited time', ['September 20, 2026 3:30 PM']).type).toBe(
      'updatedTime',
    );
    expect(inferColumn('Site', ['https://a.example', 'http://b.example/x']).type).toBe('url');
    expect(inferColumn('Email', ['a@example.com']).type).toBe('email');
    expect(inferColumn('Links', ['A (Notes/A.md)'], () => true).type).toBe('relation');
    expect(inferColumn('Links', ['A (Notes/A.md)'], () => false).type).toBe('text');
  });

  it('tells select, multi-select and text apart', () => {
    expect(inferColumn('Status', ['Done', 'Todo', 'Done', 'Doing'])).toEqual({
      name: 'Status',
      type: 'select',
      options: ['Done', 'Todo', 'Doing'],
    });
    expect(inferColumn('Tags', ['a, b', 'b', 'c, a'])).toEqual({
      name: 'Tags',
      type: 'multiSelect',
      options: ['a', 'b', 'c'],
    });
    expect(inferColumn('Tags', ['solo'])).toEqual({
      name: 'Tags',
      type: 'multiSelect',
      options: ['solo'],
    });
    expect(inferColumn('Author', ['Frank Herbert', 'Octavia Butler', 'Ursula Le Guin']).type).toBe(
      'text',
    );
    expect(inferColumn('Notes', ['Draft, review, ship', 'Call the Cape first.']).type).toBe('text');
    expect(inferColumn('Empty', ['', '']).type).toBe('text');
  });
});
