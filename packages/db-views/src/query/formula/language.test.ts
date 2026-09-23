import type { JsonValue, PropertyDefinition } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property, row, testContext } from '../../test/fixtures';
import type { QueryContext } from '../types';
import {
  FORMULA_FUNCTIONS,
  FormulaError,
  FormulaEvaluation,
  compileFormula,
  dateUnit,
  evaluateFormulaProperty,
  findFunction,
  formulaSetup,
  parseFormula,
  tokenize,
  type FormulaValue,
} from './index';

const ctx = testContext();
const status = property('status', 'select', {
  name: 'Status',
  options: options(['todo'], ['done']),
});
const tags = property('tags', 'multiSelect', { name: 'Tags', options: options(['ui'], ['api']) });
const PROPERTIES: PropertyDefinition[] = [
  property('title', 'title', { name: 'Name' }),
  property('notes', 'text', { name: 'Notes' }),
  property('link', 'url', { name: 'Link' }),
  property('pages', 'number', { name: 'Pages' }),
  status,
  tags,
  property('done', 'checkbox', { name: 'Done' }),
  property('due', 'date', { name: 'Due' }),
  property('related', 'relation', { name: 'Related' }),
  property('created', 'createdTime', { name: 'Created' }),
  property('edited', 'updatedTime', { name: 'Edited' }),
];

const BOOK = row(
  'Dune',
  {
    notes: 'A desert planet',
    link: 'https://example.org',
    pages: 688,
    status: 'done',
    tags: ['ui', 'api', 'gone'],
    done: true,
    due: { start: '2026-09-20' },
    related: ['p1', 'p2', 'hidden'],
  },
  { createdAt: Date.UTC(2026, 0, 2, 10), updatedAt: Date.UTC(2026, 8, 1, 8, 30) },
);

const titles: Record<string, string> = { p1: 'Frank Herbert', p2: '', hidden: 'Secret' };
const withPages = testContext({
  titleOf: (id) => titles[id],
  isPageVisible: (id) => id !== 'hidden',
});

function outcome(
  expression: string,
  options: {
    values?: Record<string, JsonValue>;
    extra?: PropertyDefinition[];
    context?: QueryContext;
  } = {},
) {
  const formula = property('f', 'formula', { name: 'Result', formula: { expression } });
  const setup = formulaSetup(
    [...PROPERTIES, ...(options.extra ?? []), formula],
    options.context ?? withPages,
  );
  const target = options.values ? { ...BOOK, values: { ...BOOK.values, ...options.values } } : BOOK;
  return evaluateFormulaProperty(setup, 'f', target);
}

function value(expression: string, options: Parameters<typeof outcome>[1] = {}): FormulaValue {
  const result = outcome(expression, options);
  if ('error' in result) throw result.error;
  return result.value;
}

function error(expression: string, options: Parameters<typeof outcome>[1] = {}): FormulaError {
  const result = outcome(expression, options);
  if (!('error' in result)) throw new Error(`expected an error, got ${String(result.value)}`);
  return result.error;
}

describe('tokenize', () => {
  it('reads numbers, strings, identifiers and operators with their positions', () => {
    const tokens = tokenize('prop("Pages") >= 1.5e2 && .5 != 2E-1');
    expect(tokens.map((token) => [token.kind, token.text])).toEqual([
      ['identifier', 'prop'],
      ['open', '('],
      ['string', 'Pages'],
      ['close', ')'],
      ['operator', '>='],
      ['number', '1.5e2'],
      ['operator', '&&'],
      ['number', '.5'],
      ['operator', '!='],
      ['number', '2E-1'],
      ['end', ''],
    ]);
    expect(tokens[5]?.number).toBe(150);
    expect(tokens[2]).toMatchObject({ start: 5, end: 12 });
  });

  it('decodes escapes, accepts single and curly quotes and Unicode names', () => {
    expect(tokenize(String.raw`"say \"hi\"\n\t\\ \x"`)[0]?.text).toBe('say "hi"\n\t\\ x');
    expect(tokenize("'it''s'").map((token) => token.text)).toEqual(['it', 's', '']);
    expect(tokenize('“Größe”')[0]).toMatchObject({ kind: 'string', text: 'Größe' });
    expect(tokenize('‘x’')[0]?.text).toBe('x');
    expect(tokenize('größe_2')[0]).toMatchObject({ kind: 'identifier', text: 'größe_2' });
    // An exponent needs digits: `1e` is a number and a name.
    expect(tokenize('1e').map((token) => token.kind)).toEqual(['number', 'identifier', 'end']);
  });

  it('reports unterminated strings and stray characters', () => {
    expect(() => tokenize('"open')).toThrow(FormulaError);
    try {
      tokenize('1 + @');
    } catch (thrown) {
      expect(thrown).toMatchObject({ code: 'unexpectedCharacter', start: 4, end: 5 });
    }
    try {
      tokenize('concat("a", "b)');
    } catch (thrown) {
      expect(thrown).toMatchObject({ code: 'unterminatedString', start: 12 });
    }
  });
});

describe('parse', () => {
  it('follows the usual precedence and associativity', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('2 ^ -1')).toBe(0.5);
    expect(value('10 - 4 - 3')).toBe(3);
    expect(value('+5')).toBe(5);
    expect(value('1 < 2 == true')).toBe(true);
    expect(value('true or false and false')).toBe(true);
    expect(value('TRUE AND not False')).toBe(true);
    expect(value('!true || 1 == 1')).toBe(true);
    expect(value('1 = 1')).toBe(true);
    expect(value('false ? 1 : true ? 2 : 3')).toBe(2);
    expect(value('1 > 2 ? "big" : "small"')).toBe('small');
  });

  it('reports syntax errors where they are', () => {
    expect(() => parseFormula('1 +')).toThrow(expect.objectContaining({ code: 'unexpectedEnd' }));
    expect(() => parseFormula('1 * * 2')).toThrow(
      expect.objectContaining({ code: 'unexpectedToken', start: 4, params: { token: '*' } }),
    );
    expect(() => parseFormula('(1 + 2')).toThrow(
      expect.objectContaining({ code: 'unexpectedEnd' }),
    );
    expect(() => parseFormula('1 2')).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    // Properties are read with prop("Name"), not bare names.
    expect(() => parseFormula('pages')).toThrow(
      expect.objectContaining({ code: 'unexpectedToken', params: { token: 'pages' } }),
    );
    expect(() => parseFormula('true ? 1')).toThrow(
      expect.objectContaining({ code: 'unexpectedEnd' }),
    );
    expect(() => parseFormula('prop(1)')).toThrow(
      expect.objectContaining({ code: 'propertyName' }),
    );
    expect(() => parseFormula('prop()')).toThrow(expect.objectContaining({ code: 'propertyName' }));
    expect(() => parseFormula('prop("a", "b")')).toThrow(
      expect.objectContaining({ code: 'propertyName' }),
    );
  });

  it('limits nesting and chain length', () => {
    expect(() => parseFormula(`${'('.repeat(80)}1${')'.repeat(80)}`)).toThrow(
      expect.objectContaining({ code: 'tooDeep' }),
    );
    expect(() => parseFormula(Array.from({ length: 300 }, () => '1').join(' + '))).toThrow(
      expect.objectContaining({ code: 'tooDeep' }),
    );
    expect(value(Array.from({ length: 200 }, () => '1').join(' + '))).toBe(200);
    expect(value(`sum(${Array.from({ length: 2000 }, () => '1').join(', ')})`)).toBe(2000);
  });

  it('parses calls and property references', () => {
    expect(parseFormula('prop("Pages")')).toMatchObject({ type: 'property', name: 'Pages' });
    expect(parseFormula('now()')).toMatchObject({ type: 'call', name: 'now', args: [] });
  });
});

describe('compileFormula', () => {
  it('checks functions, argument counts and property names', () => {
    const compile = (expression: string) => compileFormula(expression, PROPERTIES);
    expect(compile('')).toMatchObject({ ok: true, formula: { root: null } });
    expect(compile('   ')).toMatchObject({ ok: true });
    expect(compile('nope(1)')).toMatchObject({
      ok: false,
      error: { code: 'unknownFunction', params: { name: 'nope' } },
    });
    expect(compile('round()')).toMatchObject({
      ok: false,
      error: { code: 'argumentCount', params: { name: 'round', min: 1, max: 2 } },
    });
    expect(compile('sum()')).toMatchObject({
      ok: false,
      error: { code: 'argumentCount', params: { max: -1 } },
    });
    expect(compile('prop("Missing") + 1')).toMatchObject({
      ok: false,
      error: { code: 'unknownProperty', start: 0, end: 15, params: { name: 'Missing' } },
    });
    expect(compile('1 +')).toMatchObject({ ok: false, error: { code: 'unexpectedEnd' } });
    // Names and functions ignore case and surrounding spaces.
    expect(compile('ROUND(prop(" pages "))')).toMatchObject({ ok: true });
  });

  it('notes what results depend on', () => {
    const compiled = compileFormula('today() > prop("Due") or empty(prop("Related"))', PROPERTIES);
    expect(compiled).toMatchObject({ ok: true, formula: { usesClock: true, usesRelations: true } });
    expect(compileFormula('prop("Pages")', PROPERTIES)).toMatchObject({
      formula: { usesClock: false, usesRelations: false, formulas: [] },
    });
  });

  it('lists every function once with a signature', () => {
    const names = FORMULA_FUNCTIONS.map((fn) => fn.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const fn of FORMULA_FUNCTIONS) expect(fn.signature.startsWith(`${fn.name}(`)).toBe(true);
    expect(findFunction('DATEADD')?.name).toBe('dateAdd');
    expect(dateUnit(' Days ')).toBe('days');
    expect(dateUnit('fortnights')).toBeNull();
  });
});

describe('reading properties', () => {
  it('reads every type in a formula-friendly form', () => {
    expect(value('prop("Name")')).toBe('Dune');
    expect(value('prop("Notes")')).toBe('A desert planet');
    expect(value('prop("Notes")', { values: { notes: 42 } })).toBe('');
    expect(value('prop("Link")')).toBe('https://example.org');
    expect(value('prop("Pages")')).toBe(688);
    expect(value('prop("Pages")', { values: { pages: 'many' } })).toBeNull();
    expect(value('prop("Status")')).toBe('Done');
    expect(value('prop("Status")', { values: { status: 'gone' } })).toBeNull();
    expect(value('prop("Tags")')).toBe('Ui, Api');
    expect(value('prop("Tags")', { values: { tags: [] } })).toBeNull();
    expect(value('prop("Done")')).toBe(true);
    expect(value('prop("Done")', { values: { done: false } })).toBe(false);
    expect(value('prop("Due")')).toEqual({ start: '2026-09-20' });
    expect(value('prop("Due")', { values: { due: 'soon' } })).toBeNull();
    // Only visible pages with a title count.
    expect(value('prop("Related")')).toBe('Frank Herbert');
    expect(value('prop("Related")', { context: ctx })).toBeNull();
    expect(value('prop("Created")')).toEqual({
      start: '2026-01-02T10:00:00.000Z',
      includeTime: true,
    });
    expect(value('prop("Edited")')).toEqual({
      start: '2026-09-01T08:30:00.000Z',
      includeTime: true,
    });
  });

  it('reads other formulas, and reports loops', () => {
    const half = property('half', 'formula', {
      name: 'Half',
      formula: { expression: 'prop("Pages") / 2' },
    });
    expect(value('prop("Half") + 1', { extra: [half] })).toBe(345);
    const broken = property('broken', 'formula', {
      name: 'Broken',
      formula: { expression: 'prop("Pages") / 0' },
    });
    expect(value('prop("Broken")', { extra: [broken] })).toBeNull();
    const bad = property('bad', 'formula', { name: 'Bad', formula: { expression: '1 +' } });
    expect(value('prop("Bad")', { extra: [bad] })).toBeNull();
    const loop = property('loop', 'formula', {
      name: 'Loop',
      formula: { expression: 'prop("Result") + 1' },
    });
    expect(error('prop("Loop")', { extra: [loop] })).toMatchObject({
      code: 'circular',
      start: 0,
      params: { name: 'Loop' },
    });
    expect(error('prop("Result")')).toMatchObject({ code: 'circular' });
  });

  it('stops formulas that take too many steps', () => {
    const ones = `sum(${Array.from({ length: 3000 }, () => '1').join(',')})`;
    const chain: PropertyDefinition[] = [];
    for (let i = 0; i < 8; i += 1) {
      chain.push(
        property(`c${i}`, 'formula', {
          name: `C${i}`,
          formula: { expression: i === 0 ? ones : `${ones} + prop("C${i - 1}")` },
        }),
      );
    }
    expect(error('prop("C7")', { extra: chain })).toMatchObject({ code: 'tooComplex' });
  });
});

describe('operators', () => {
  it('computes with numbers and propagates empty values', () => {
    expect(value('prop("Pages") / 8')).toBe(86);
    expect(value('7 % 4 * 2 - 1')).toBe(5);
    expect(value('0.1 + 0.2 == 0.3')).toBe(true);
    expect(value('prop("Pages") * 2', { values: { pages: null } })).toBeNull();
    expect(value('-prop("Pages")', { values: { pages: null } })).toBeNull();
    expect(error('1 / 0')).toMatchObject({ code: 'divisionByZero' });
    expect(error('1 % 0')).toMatchObject({ code: 'divisionByZero' });
    expect(error('10 ^ 400')).toMatchObject({ code: 'invalidNumber' });
    expect(error('-"a"')).toMatchObject({
      code: 'typeMismatch',
      params: { name: '-', actual: 'text' },
    });
    expect(error('true * 2')).toMatchObject({
      code: 'typeMismatch',
      params: { name: '*', expected: 'number', actual: 'boolean' },
    });
    expect(error('2 * prop("Due")')).toMatchObject({
      code: 'typeMismatch',
      params: { actual: 'date' },
    });
  });

  it('joins text with +, formatting other values', () => {
    expect(value('prop("Name") + " (" + prop("Pages") + " pages)"')).toBe('Dune (688 pages)');
    expect(value('"Due " + prop("Due")')).toBe('Due Sep 20, 2026');
    expect(value('"" + true + "/" + prop("Pages") * 0.1')).toBe('true/68.8');
    expect(value('"x" + prop("Pages")', { values: { pages: null } })).toBe('x');
    expect(error(`"${'a'.repeat(6000)}" + "${'b'.repeat(6000)}"`)).toMatchObject({
      code: 'textTooLong',
    });
  });

  it('compares numbers, text, booleans and dates', () => {
    expect(value('2 < 10')).toBe(true);
    expect(value('"apple" < "Banana"')).toBe(true);
    expect(value('"item 2" < "item 10"')).toBe(true);
    expect(value('false < true')).toBe(true);
    expect(value('prop("Due") >= today()')).toBe(false);
    expect(value('prop("Due") <= prop("Due")')).toBe(true);
    expect(value('prop("Pages") > prop("Due")', { values: { due: null } })).toBeNull();
    // Empty text is text, so it can't be compared with a number.
    expect(error('prop("Pages") > prop("Notes")', { values: { notes: null } })).toMatchObject({
      code: 'typeMismatch',
    });
    expect(error('1 < "2"')).toMatchObject({ code: 'typeMismatch' });
    expect(value('prop("Pages") > 1', { values: { pages: null } })).toBeNull();
  });

  it('checks equality by kind', () => {
    expect(value('prop("Due") == dateAdd(today(), -3, "days")')).toBe(true);
    expect(value('prop("Due") == prop("Created")')).toBe(false);
    expect(value('prop("Due") != dateRange(prop("Due"), prop("Due"))')).toBe(false);
    expect(value('1 == "1"')).toBe(false);
    expect(value('prop("Pages") == prop("Pages")', { values: { pages: null } })).toBe(true);
  });
});

describe('functions', () => {
  it('logic', () => {
    expect(value('if(prop("Done"), "yes", "no")')).toBe('yes');
    expect(value('if(0, "yes")')).toBeNull();
    // Only the branch that is taken runs.
    expect(value('if(true, 1, 1 / 0)')).toBe(1);
    expect(value('and(true, 1, "x", today())')).toBe(true);
    expect(value('and(true, "")')).toBe(false);
    expect(value('or(false, 0, prop("Pages"))')).toBe(true);
    expect(value('or(false, "")')).toBe(false);
    expect(value('not(prop("Done"))')).toBe(false);
    expect(value('empty(prop("Notes"))', { values: { notes: '' } })).toBe(true);
    expect(value('empty(0)')).toBe(false);
  });

  it('math', () => {
    expect(value('abs(-3)')).toBe(3);
    expect(value('round(2.345, 2)')).toBe(2.35);
    expect(value('round(2.5)')).toBe(3);
    expect(value('round(1.23456, 50)')).toBe(1.23456);
    expect(value('round(prop("Pages"))', { values: { pages: null } })).toBeNull();
    expect(value('floor(2.7) + ceil(2.1)')).toBe(5);
    expect(value('sqrt(16)')).toBe(4);
    expect(value('sqrt(prop("Pages"))', { values: { pages: null } })).toBeNull();
    expect(error('sqrt(-1)')).toMatchObject({ code: 'invalidNumber' });
    expect(value('pow(2, 10)')).toBe(1024);
    expect(value('pow(prop("Pages"), 2)', { values: { pages: null } })).toBeNull();
    expect(value('sign(-4)')).toBe(-1);
    expect(value('min(3, prop("Pages"), 7)')).toBe(3);
    expect(value('max(3, prop("Pages"), 7)')).toBe(688);
    expect(value('sum(1, 2, prop("Pages"))', { values: { pages: null } })).toBe(3);
    expect(value('min(prop("Pages"))', { values: { pages: null } })).toBeNull();
    expect(error('abs("x")')).toMatchObject({
      code: 'typeMismatch',
      params: { name: 'abs', expected: 'number', actual: 'text' },
    });
    expect(value('toNumber("1,200.5")')).toBe(1200.5);
    expect(value('toNumber("12%")')).toBe(0.12);
    expect(value('toNumber("n/a")')).toBeNull();
    expect(value('toNumber(true) + toNumber(false)')).toBe(1);
    expect(value('toNumber(5)')).toBe(5);
    expect(value('toNumber(prop("Due"))')).toBe(Date.UTC(2026, 8, 20));
  });

  it('text', () => {
    expect(value('concat(prop("Name"), " by ", prop("Related"), " ", 2026)')).toBe(
      'Dune by Frank Herbert 2026',
    );
    expect(value('format(prop("Pages"))')).toBe('688');
    expect(value('format(prop("Done"))')).toBe('true');
    expect(value('length("Größe 🙂")')).toBe(7);
    expect(value('lower("ÉCOLE") + upper("éa") + trim("  x  ")')).toBe('écoleÉAx');
    expect(value('contains(prop("Notes"), "DESERT")')).toBe(true);
    expect(value('startsWith(prop("Notes"), "a ")')).toBe(true);
    expect(value('endsWith(prop("Notes"), "moon")')).toBe(false);
    expect(value('replace("a-b-c", "-", " / ")')).toBe('a / b / c');
    expect(value('replace("abc", "", "x")')).toBe('abc');
    expect(error(`replace("${'a'.repeat(2000)}", "a", "aaaaaaaaaa")`)).toMatchObject({
      code: 'textTooLong',
    });
    expect(value('slice("🙂abcdef", 1, 3)')).toBe('ab');
    expect(value('slice("abcdef", 2)')).toBe('cdef');
    expect(value('slice("abcdef", prop("Pages"))', { values: { pages: null } })).toBe('abcdef');
    expect(value('slice("abcdef", 1, prop("Pages"))', { values: { pages: null } })).toBe('bcdef');
  });

  it('dates: now, today, parts and formatting', () => {
    expect(value('now()')).toEqual({ start: '2026-09-23T12:00:00.000Z', includeTime: true });
    expect(value('today()')).toEqual({ start: '2026-09-23' });
    const tokyo = testContext({ timeZone: 'Asia/Tokyo', now: Date.UTC(2026, 8, 23, 20) });
    expect(value('today()', { context: tokyo })).toEqual({ start: '2026-09-24' });
    expect(value('year(prop("Due")) * 10000 + month(prop("Due")) * 100 + day(prop("Due"))')).toBe(
      20260920,
    );
    expect(value('weekday(prop("Due"))')).toBe(7);
    expect(value('weekday(today())')).toBe(3);
    expect(value('hour(prop("Edited")) * 100 + minute(prop("Edited"))')).toBe(830);
    expect(value('hour(prop("Due"))')).toBe(0);
    const paris = testContext({ timeZone: 'Europe/Paris' });
    expect(value('hour(prop("Edited"))', { context: paris })).toBe(10);
    expect(value('formatDate(prop("Due"))')).toBe('Sep 20, 2026');
    expect(value('formatDate(prop("Due"))', { values: { due: null } })).toBeNull();
    expect(value('timestamp(prop("Edited"))')).toBe(Date.UTC(2026, 8, 1, 8, 30));
    expect(value('fromTimestamp(0)')).toEqual({
      start: '1970-01-01T00:00:00.000Z',
      includeTime: true,
    });
    expect(error('fromTimestamp(1e20)')).toMatchObject({ code: 'invalidNumber' });
    expect(value('fromTimestamp(prop("Pages"))', { values: { pages: null } })).toBeNull();
    expect(value('year(prop("Due"))', { values: { due: null } })).toBeNull();
    expect(value('timestamp(prop("Due"))', { values: { due: null } })).toBeNull();
    expect(error('year(1)')).toMatchObject({ code: 'typeMismatch', params: { expected: 'date' } });
  });

  it('dates: adding and subtracting', () => {
    expect(value('dateAdd(prop("Due"), 3, "days")')).toEqual({ start: '2026-09-23' });
    expect(value('dateSubtract(prop("Due"), 1, "weeks")')).toEqual({ start: '2026-09-13' });
    expect(value('dateAdd(prop("Due"), 5, "months")')).toEqual({ start: '2027-02-20' });
    expect(value('dateAdd(prop("Due"), 1, "quarter")')).toEqual({ start: '2026-12-20' });
    expect(value('dateAdd(prop("Due"), -2, "y")')).toEqual({ start: '2024-09-20' });
    expect(value('dateAdd(prop("Due"), 1.9, "days")')).toEqual({ start: '2026-09-21' });
    // Month ends clamp.
    expect(
      value('dateAdd(prop("Due"), 1, "month")', { values: { due: { start: '2026-01-31' } } }),
    ).toEqual({ start: '2026-02-28' });
    // Ranges move as a whole.
    expect(
      value('dateAdd(prop("Due"), 2, "days")', {
        values: { due: { start: '2026-09-20', end: '2026-09-22' } },
      }),
    ).toEqual({ start: '2026-09-22', end: '2026-09-24' });
    // Hours turn a day into a time (midnight in the viewer's zone).
    expect(value('dateAdd(prop("Due"), 90, "minutes")')).toEqual({
      start: '2026-09-20T01:30:00.000Z',
      includeTime: true,
    });
    expect(
      value('dateAdd(prop("Due"), 1, "hour")', {
        values: { due: { start: '2026-09-20', end: '2026-09-21' } },
      }),
    ).toEqual({
      start: '2026-09-20T01:00:00.000Z',
      end: '2026-09-21T01:00:00.000Z',
      includeTime: true,
    });
    const meeting = {
      start: '2026-10-30T13:30:15.000Z',
      includeTime: true,
      timeZone: 'America/New_York',
    };
    // Calendar units keep the wall-clock time across the November DST change.
    expect(value('dateAdd(prop("Due"), 3, "days")', { values: { due: meeting } })).toEqual({
      ...meeting,
      start: '2026-11-02T14:30:15.000Z',
    });
    expect(value('dateAdd(prop("Due"), 2, "hours")', { values: { due: meeting } })).toEqual({
      start: '2026-10-30T15:30:15.000Z',
      includeTime: true,
      timeZone: 'America/New_York',
    });
    expect(
      value('dateAdd(prop("Due"), 1, "day")', {
        values: {
          due: {
            start: '2026-09-20T09:00:00.000Z',
            end: '2026-09-20T10:00:00.000Z',
            includeTime: true,
          },
        },
      }),
    ).toEqual({
      start: '2026-09-21T09:00:00.000Z',
      end: '2026-09-21T10:00:00.000Z',
      includeTime: true,
    });
    expect(
      value('dateAdd(prop("Due"), prop("Pages"), "days")', { values: { pages: null } }),
    ).toBeNull();
    expect(error('dateAdd(prop("Due"), 1, "fortnights")')).toMatchObject({
      code: 'invalidUnit',
      params: { unit: 'fortnights' },
    });
  });

  it('dates: differences', () => {
    const between = (a: string, b: string, unit: string) =>
      value(`dateBetween(prop("Due"), prop("Other"), "${unit}")`, {
        extra: [property('other', 'date', { name: 'Other' })],
        values: {
          due: a.includes('T') ? { start: a, includeTime: true } : { start: a },
          other: b.includes('T') ? { start: b, includeTime: true } : { start: b },
        },
      });
    expect(between('2026-09-20', '2026-09-01', 'days')).toBe(19);
    expect(between('2026-09-01', '2026-09-20', 'days')).toBe(-19);
    expect(between('2026-09-20', '2026-09-01', 'weeks')).toBe(2);
    expect(between('2026-09-20', '2026-01-21', 'months')).toBe(7);
    expect(between('2026-09-21', '2026-01-21', 'months')).toBe(8);
    expect(between('2026-01-21', '2026-09-20', 'months')).toBe(-7);
    expect(between('2026-09-20', '2025-10-01', 'quarters')).toBe(3);
    expect(between('2026-09-20', '2024-09-21', 'years')).toBe(1);
    expect(between('2026-09-20T10:00:00.000Z', '2026-09-20', 'hours')).toBe(10);
    expect(between('2026-09-20T10:00:00.000Z', '2026-09-20T09:15:00.000Z', 'minutes')).toBe(45);
    expect(between('2026-09-22T06:00:00.000Z', '2026-09-20T12:00:00.000Z', 'days')).toBe(1);
    expect(between('2026-10-20T09:00:00.000Z', '2026-09-20T10:00:00.000Z', 'months')).toBe(0);
    expect(
      value('dateBetween(prop("Due"), today(), "days")', { values: { due: null } }),
    ).toBeNull();
  });

  it('dates: ranges and their ends', () => {
    expect(value('dateRange(today(), prop("Due"))')).toEqual({
      start: '2026-09-20',
      end: '2026-09-23',
    });
    expect(value('dateRange(prop("Due"), today())')).toEqual({
      start: '2026-09-20',
      end: '2026-09-23',
    });
    expect(error('dateRange(now(), today())')).toMatchObject({ code: 'typeMismatch' });
    expect(value('dateRange(prop("Due"), today())', { values: { due: null } })).toBeNull();
    const range = { values: { due: { start: '2026-09-20', end: '2026-09-25' } } };
    expect(value('start(prop("Due"))', range)).toEqual({ start: '2026-09-20' });
    expect(value('end(prop("Due"))', range)).toEqual({ start: '2026-09-25' });
    expect(value('end(prop("Due"))')).toEqual({ start: '2026-09-20' });
    expect(value('start(prop("Due"))', { values: { due: null } })).toBeNull();
  });
});

describe('evaluating trees that were not compiled', () => {
  it('reports unknown functions and properties instead of failing', () => {
    const evaluate = (expression: string) => {
      const formula = {
        expression,
        root: parseFormula(expression),
        references: new Map([['ghost', 'ghost']]),
        usesClock: false,
        usesRelations: false,
      };
      const env = {
        ctx,
        byId: new Map(PROPERTIES.map((entry) => [entry.id, entry])),
        compiled: () => formula,
      };
      return new FormulaEvaluation(BOOK, env).property('f');
    };
    expect(() => evaluate('nope(1)')).toThrow(
      expect.objectContaining({ code: 'unknownFunction', params: { name: 'nope' } }),
    );
    expect(() => evaluate('prop("Ghost")')).toThrow(
      expect.objectContaining({ code: 'unknownProperty' }),
    );
    expect(evaluate('not(0)')).toBe(true);
  });
});
