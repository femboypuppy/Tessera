import { describe, expect, it } from 'vitest';
import { fromTsv, toHtmlTable, toTsv } from './clipboard';
import {
  inRange,
  navigate,
  rangeSize,
  selectionRange,
  type GridBounds,
  type GridSelection,
} from './navigation';

const bounds: GridBounds = { rowCount: 10, colCount: 4, pageSize: 3, header: true, footer: true };
const at = (row: number, col: number): GridSelection => ({
  active: { row, col },
  anchor: { row, col },
});
const key = (name: string, options: { shift?: boolean; mod?: boolean } = {}) => ({
  key: name,
  shiftKey: options.shift ?? false,
  modKey: options.mod ?? false,
});

describe('navigate', () => {
  it('moves with the arrows and stops at the edges', () => {
    expect(navigate(at(2, 1), key('ArrowDown'), bounds)).toEqual(at(3, 1));
    expect(navigate(at(2, 1), key('ArrowUp'), bounds)).toEqual(at(1, 1));
    expect(navigate(at(2, 1), key('ArrowLeft'), bounds)).toEqual(at(2, 0));
    expect(navigate(at(2, 1), key('ArrowRight'), bounds)).toEqual(at(2, 2));
    expect(navigate(at(2, 0), key('ArrowLeft'), bounds)).toEqual(at(2, 0));
    expect(navigate(at(2, 3), key('ArrowRight'), bounds)).toEqual(at(2, 3));
  });

  it('reaches the header and footer rows when they can be focused', () => {
    expect(navigate(at(0, 1), key('ArrowUp'), bounds)).toEqual(at(-1, 1));
    expect(navigate(at(-1, 1), key('ArrowUp'), bounds)).toEqual(at(-1, 1));
    expect(navigate(at(9, 1), key('ArrowDown'), bounds)).toEqual(at(10, 1));
    expect(navigate(at(10, 1), key('ArrowDown'), bounds)).toEqual(at(10, 1));
    const bodyOnly = { ...bounds, header: false, footer: false };
    expect(navigate(at(0, 1), key('ArrowUp'), bodyOnly)).toEqual(at(0, 1));
    expect(navigate(at(9, 1), key('ArrowDown'), bodyOnly)).toEqual(at(9, 1));
  });

  it('jumps to the edges with Mod, then to the header or footer', () => {
    expect(navigate(at(5, 2), key('ArrowUp', { mod: true }), bounds)).toEqual(at(0, 2));
    expect(navigate(at(0, 2), key('ArrowUp', { mod: true }), bounds)).toEqual(at(-1, 2));
    expect(navigate(at(5, 2), key('ArrowDown', { mod: true }), bounds)).toEqual(at(9, 2));
    expect(navigate(at(9, 2), key('ArrowDown', { mod: true }), bounds)).toEqual(at(10, 2));
    expect(navigate(at(5, 2), key('ArrowLeft', { mod: true }), bounds)).toEqual(at(5, 0));
    expect(navigate(at(5, 2), key('ArrowRight', { mod: true }), bounds)).toEqual(at(5, 3));
  });

  it('supports Home, End and paging', () => {
    expect(navigate(at(5, 2), key('Home'), bounds)).toEqual(at(5, 0));
    expect(navigate(at(5, 2), key('End'), bounds)).toEqual(at(5, 3));
    expect(navigate(at(5, 2), key('Home', { mod: true }), bounds)).toEqual(at(0, 0));
    expect(navigate(at(5, 2), key('End', { mod: true }), bounds)).toEqual(at(9, 3));
    expect(navigate(at(5, 2), key('PageUp'), bounds)).toEqual(at(2, 2));
    expect(navigate(at(5, 2), key('PageDown'), bounds)).toEqual(at(8, 2));
    expect(navigate(at(1, 2), key('PageUp'), bounds)).toEqual(at(-1, 2));
  });

  it('moves with Tab across rows, and stops at the ends', () => {
    expect(navigate(at(2, 1), key('Tab'), bounds)).toEqual(at(2, 2));
    expect(navigate(at(2, 3), key('Tab'), bounds)).toEqual(at(3, 0));
    expect(navigate(at(2, 0), key('Tab', { shift: true }), bounds)).toEqual(at(1, 3));
    expect(navigate(at(9, 3), key('Tab'), bounds)).toBeNull();
    expect(navigate(at(0, 0), key('Tab', { shift: true }), bounds)).toBeNull();
  });

  it('extends a range with Shift within body rows only', () => {
    const range = navigate(at(2, 1), key('ArrowDown', { shift: true }), bounds);
    expect(range).toEqual({ active: { row: 3, col: 1 }, anchor: { row: 2, col: 1 } });
    const wider = navigate(range ?? at(0, 0), key('ArrowRight', { shift: true }), bounds);
    expect(wider).toEqual({ active: { row: 3, col: 2 }, anchor: { row: 2, col: 1 } });
    // Into the header: the range collapses.
    expect(navigate(at(0, 1), key('ArrowUp', { shift: true }), bounds)).toEqual(at(-1, 1));
    // From the header: no range either.
    expect(navigate(at(-1, 1), key('ArrowDown', { shift: true }), bounds)).toEqual(at(0, 1));
  });

  it('ignores other keys and copes with empty tables', () => {
    expect(navigate(at(2, 1), key('a'), bounds)).toBeNull();
    const empty = { ...bounds, rowCount: 0 };
    expect(navigate(at(-1, 0), key('ArrowDown'), empty)).toEqual(at(0, 0));
    expect(navigate(at(0, 0), key('ArrowDown'), empty)).toEqual(at(0, 0));
    expect(navigate(at(0, 0), key('ArrowUp'), { ...empty, footer: false })).toEqual(at(-1, 0));
  });
});

describe('selection ranges', () => {
  it('measures and tests the rectangle between the corners', () => {
    const range = selectionRange({ active: { row: 1, col: 3 }, anchor: { row: 4, col: 1 } });
    expect(range).toEqual({ top: 1, bottom: 4, left: 1, right: 3 });
    expect(rangeSize(range)).toBe(12);
    expect(inRange(range, 2, 2)).toBe(true);
    expect(inRange(range, 0, 2)).toBe(false);
    expect(inRange(range, 2, 0)).toBe(false);
    expect(rangeSize(selectionRange(at(3, 3)))).toBe(1);
  });
});

describe('clipboard', () => {
  it('writes TSV and reads it back, quoting tabs, line breaks and quotes', () => {
    const block = [
      ['Dune', 'Frank Herbert', '688'],
      ['Notes', 'Line one\nline two', 'Say "hi"'],
      ['Tabbed\tcell', '', 'end'],
    ];
    const text = toTsv(block);
    expect(text.split('\n')[0]).toBe('Dune\tFrank Herbert\t688');
    expect(text).toContain('"Line one\nline two"');
    expect(text).toContain('"Say ""hi"""');
    expect(fromTsv(text)).toEqual(block);
  });

  it('reads spreadsheet TSV (CRLF, a trailing line break, empty cells)', () => {
    expect(fromTsv('a\tb\r\nc\t\r\n')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
    expect(fromTsv('')).toEqual([]);
    expect(fromTsv('only')).toEqual([['only']]);
    // A quote inside a cell (not at its start) is literal.
    expect(fromTsv('5" screen\tok')).toEqual([['5" screen', 'ok']]);
  });

  it('writes an HTML table with escaped text', () => {
    expect(toHtmlTable([['<b>&', 'a\nb']])).toBe(
      '<table><tr><td>&lt;b&gt;&amp;</td><td>a<br>b</td></tr></table>',
    );
  });
});
