import type { DateValue, PropertyDefinition } from '@tessera/core';
import { readCell, readDateValue, readIds } from '../cells';
import {
  DAY_MS,
  addDays,
  addMonths,
  dayKeyOfInstant,
  dayOfWeek,
  daysBetween,
  parseDayKey,
  startOfDayInstant,
  timeOfInstant,
  todayKey,
  zonedTimeToInstant,
} from '../dates';
import { cleanNumber, formatDateValue } from '../format';
import { parseNumberText } from '../parse';
import { sortCollator } from '../text';
import type { QueryContext, QueryRow } from '../types';
import { dateUnit, findFunction, type DateUnit } from './functions';
import type { FormulaNode } from './parse';
import { FormulaError, type FormulaErrorParams } from './tokens';
import {
  MAX_FORMULA_TEXT,
  isDateResult,
  isEmptyResult,
  truthy,
  typeOf,
  type FormulaValue,
} from './values';

/** A formula ready to evaluate (see `compileFormula`). */
export interface CompiledFormula {
  expression: string;
  /** Null for an empty formula (its cells are empty). */
  root: FormulaNode | null;
  /** The property each `prop("Name")` reads, by trimmed, lower-cased name. */
  references: ReadonlyMap<string, string>;
  /** Calls `now()` or `today()`: results change with the clock. */
  usesClock: boolean;
  /** Reads a relation: results change with the titles of other pages. */
  usesRelations: boolean;
}

/** What evaluation needs besides the row. */
export interface FormulaEnvironment {
  ctx: QueryContext;
  byId: ReadonlyMap<string, PropertyDefinition>;
  /** The compiled formula of a formula property, or null when it doesn't compile. */
  compiled(propertyId: string): CompiledFormula | null;
}

/** Most steps one row's evaluation may take (nested formulas included). */
export const MAX_FORMULA_STEPS = 20_000;

/** The key `prop("Name")` references are stored under. */
export function propertyKey(name: string): string {
  return name.trim().toLowerCase();
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function mismatch(
  node: FormulaNode,
  name: string,
  expected: string,
  value: FormulaValue,
): FormulaError {
  return new FormulaError('typeMismatch', node.start, node.end, {
    name,
    expected,
    actual: typeOf(value),
  });
}

function checkNumber(value: number, node: FormulaNode): number {
  if (!Number.isFinite(value)) throw new FormulaError('invalidNumber', node.start, node.end);
  return value;
}

function checkText(text: string, node: FormulaNode): string {
  if (text.length > MAX_FORMULA_TEXT) {
    throw new FormulaError('textTooLong', node.start, node.end, { max: MAX_FORMULA_TEXT });
  }
  return text;
}

/** The zone a date is read in: its own when it has one, else the viewer's. */
function zoneOf(value: DateValue, ctx: QueryContext): string {
  return value.includeTime && value.timeZone ? value.timeZone : ctx.timeZone;
}

/** The instant a date starts (date-only values start at midnight in the viewer's zone). */
function startMs(value: DateValue, ctx: QueryContext): number {
  return value.includeTime ? Date.parse(value.start) : startOfDayInstant(value.start, ctx.timeZone);
}

/** The day and wall-clock time of a date's start, in its zone. */
function wallClock(
  value: DateValue,
  ctx: QueryContext,
): { day: string; hour: number; minute: number; rest: number } {
  if (!value.includeTime) return { day: value.start, hour: 0, minute: 0, rest: 0 };
  const ms = Date.parse(value.start);
  const zone = zoneOf(value, ctx);
  const { hour, minute } = timeOfInstant(ms, zone);
  return {
    day: dayKeyOfInstant(ms, zone),
    hour,
    minute,
    rest: ((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS,
  };
}

function shiftPoint(
  point: string,
  value: DateValue,
  months: number,
  days: number,
  ctx: QueryContext,
): string {
  const move = (day: string) => addDays(months !== 0 ? addMonths(day, months) : day, days);
  if (!value.includeTime) return move(point);
  const ms = Date.parse(point);
  const zone = zoneOf(value, ctx);
  const { hour, minute } = timeOfInstant(ms, zone);
  const rest = ((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return new Date(
    zonedTimeToInstant(move(dayKeyOfInstant(ms, zone)), hour, minute, zone) + rest,
  ).toISOString();
}

/** Adds an amount of a unit to a date (calendar units keep the wall-clock time). */
function addToDate(value: DateValue, amount: number, unit: DateUnit, ctx: QueryContext): DateValue {
  if (unit === 'hours' || unit === 'minutes') {
    const delta = amount * (unit === 'hours' ? HOUR_MS : MINUTE_MS);
    const shift = (point: string) =>
      new Date(
        (value.includeTime ? Date.parse(point) : startOfDayInstant(point, ctx.timeZone)) + delta,
      ).toISOString();
    const result: DateValue = { start: shift(value.start), includeTime: true };
    if (value.end) result.end = shift(value.end);
    if (value.includeTime && value.timeZone) result.timeZone = value.timeZone;
    return result;
  }
  const whole = Math.trunc(amount);
  const months =
    unit === 'years' ? whole * 12 : unit === 'quarters' ? whole * 3 : unit === 'months' ? whole : 0;
  const days = unit === 'weeks' ? whole * 7 : unit === 'days' ? whole : 0;
  const result: DateValue = { ...value, start: shiftPoint(value.start, value, months, days, ctx) };
  if (value.end) result.end = shiftPoint(value.end, value, months, days, ctx);
  return result;
}

/** `a - b` in whole units, truncated toward zero. */
function difference(a: DateValue, b: DateValue, unit: DateUnit, ctx: QueryContext): number {
  if (unit === 'hours' || unit === 'minutes') {
    return Math.trunc(
      (startMs(a, ctx) - startMs(b, ctx)) / (unit === 'hours' ? HOUR_MS : MINUTE_MS),
    );
  }
  if (unit === 'days' || unit === 'weeks') {
    const days =
      a.includeTime || b.includeTime
        ? Math.trunc((startMs(a, ctx) - startMs(b, ctx)) / DAY_MS)
        : daysBetween(b.start, a.start);
    return unit === 'weeks' ? Math.trunc(days / 7) : days;
  }
  const from = wallClock(b, ctx);
  const to = wallClock(a, ctx);
  const fromParts = parseDayKey(from.day);
  const toParts = parseDayKey(to.day);
  if (!fromParts || !toParts) return 0;
  let months = (toParts.year - fromParts.year) * 12 + (toParts.month - fromParts.month);
  // Not a whole month yet when the later date's day (and time) comes before the earlier one's.
  const clock = (parts: { day: number }, time: typeof from) =>
    ((parts.day * 24 + time.hour) * 60 + time.minute) * MINUTE_MS + time.rest;
  if (months > 0 && clock(toParts, to) < clock(fromParts, from)) months -= 1;
  if (months < 0 && clock(toParts, to) > clock(fromParts, from)) months += 1;
  if (unit === 'quarters') return Math.trunc(months / 3);
  if (unit === 'years') return Math.trunc(months / 12);
  return months;
}

/**
 * Evaluates one formula for one row. Errors (a type mismatch, a division by zero, a loop between
 * formulas) throw a {@link FormulaError}; callers show those cells as empty.
 */
export class FormulaEvaluation {
  private steps = 0;
  private readonly visiting = new Set<string>();
  private readonly results = new Map<string, FormulaValue>();

  constructor(
    private readonly row: QueryRow,
    private readonly env: FormulaEnvironment,
  ) {}

  /** The value of a formula property for this row (formulas it reads are evaluated once). */
  property(propertyId: string): FormulaValue {
    const known = this.results.get(propertyId);
    if (known !== undefined) return known;
    const formula = this.env.compiled(propertyId);
    if (!formula?.root) return null;
    this.visiting.add(propertyId);
    try {
      const value = this.run(formula.root, formula);
      this.results.set(propertyId, value);
      return value;
    } finally {
      this.visiting.delete(propertyId);
    }
  }

  private text(value: FormulaValue): string {
    if (value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(cleanNumber(value));
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return formatDateValue(value, undefined, this.env.ctx);
  }

  private run(node: FormulaNode, formula: CompiledFormula): FormulaValue {
    this.steps += 1;
    if (this.steps > MAX_FORMULA_STEPS) {
      throw new FormulaError('tooComplex', node.start, node.end);
    }
    switch (node.type) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;
      case 'property':
        return this.readProperty(node, formula);
      case 'unary': {
        const value = this.run(node.operand, formula);
        if (node.operator === 'not') return !truthy(value);
        if (value === null) return null;
        if (typeof value !== 'number') throw mismatch(node, '-', 'number', value);
        return -value;
      }
      case 'conditional':
        return truthy(this.run(node.test, formula))
          ? this.run(node.then, formula)
          : this.run(node.otherwise, formula);
      case 'binary':
        return this.binary(node, formula);
      case 'call':
        return this.call(node, formula);
    }
  }

  private readProperty(
    node: Extract<FormulaNode, { type: 'property' }>,
    formula: CompiledFormula,
  ): FormulaValue {
    const id = formula.references.get(propertyKey(node.name));
    const property = id ? this.env.byId.get(id) : undefined;
    if (!property) {
      throw new FormulaError('unknownProperty', node.start, node.end, { name: node.name });
    }
    const { row } = this;
    const { ctx } = this.env;
    switch (property.type) {
      case 'title':
        return row.title;
      case 'text':
      case 'url':
      case 'email': {
        const value = readCell(row, property);
        return typeof value === 'string' ? value : '';
      }
      case 'number': {
        const value = readCell(row, property);
        return typeof value === 'number' ? value : null;
      }
      case 'checkbox':
        return readCell(row, property) === true;
      case 'select':
      case 'multiSelect': {
        const names = readIds(row, property)
          .map((optionId) => property.options?.find((option) => option.id === optionId)?.name)
          .filter((name): name is string => !!name);
        return names.length > 0 ? names.join(', ') : null;
      }
      case 'relation': {
        const titles = readIds(row, property)
          .filter((pageId) => (ctx.isPageVisible ? ctx.isPageVisible(pageId) : true))
          .map((pageId) => ctx.titleOf?.(pageId)?.trim() ?? '')
          .filter((title) => title !== '');
        return titles.length > 0 ? titles.join(', ') : null;
      }
      case 'date':
        return readDateValue(row.values[property.id]);
      case 'createdTime':
        return { start: new Date(row.createdAt).toISOString(), includeTime: true };
      case 'updatedTime':
        return { start: new Date(row.updatedAt).toISOString(), includeTime: true };
      case 'formula': {
        if (this.visiting.has(property.id)) {
          throw new FormulaError('circular', node.start, node.end, { name: property.name });
        }
        try {
          return this.property(property.id);
        } catch (error) {
          // A loop is this formula's problem; other errors belong to the formula it reads.
          if (
            error instanceof FormulaError &&
            (error.code === 'circular' || error.code === 'tooComplex')
          ) {
            throw new FormulaError(error.code, node.start, node.end, { name: property.name });
          }
          return null;
        }
      }
    }
  }

  private binary(
    node: Extract<FormulaNode, { type: 'binary' }>,
    formula: CompiledFormula,
  ): FormulaValue {
    const { operator } = node;
    if (operator === 'and') {
      return truthy(this.run(node.left, formula)) && truthy(this.run(node.right, formula));
    }
    if (operator === 'or') {
      return truthy(this.run(node.left, formula)) || truthy(this.run(node.right, formula));
    }
    const left = this.run(node.left, formula);
    const right = this.run(node.right, formula);
    switch (operator) {
      case '==':
        return this.equals(left, right);
      case '!=':
        return !this.equals(left, right);
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const order = this.compare(left, right, node, operator);
        if (order === null) return null;
        if (operator === '<') return order < 0;
        if (operator === '<=') return order <= 0;
        if (operator === '>') return order > 0;
        return order >= 0;
      }
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return checkText(this.text(left) + this.text(right), node);
        }
        break;
      default:
        break;
    }
    if (left === null || right === null) return null;
    if (typeof left !== 'number') throw mismatch(node, operator, 'number', left);
    if (typeof right !== 'number') throw mismatch(node, operator, 'number', right);
    switch (operator) {
      case '+':
        return checkNumber(left + right, node);
      case '-':
        return checkNumber(left - right, node);
      case '*':
        return checkNumber(left * right, node);
      case '/':
      case '%':
        if (right === 0) throw new FormulaError('divisionByZero', node.start, node.end);
        return checkNumber(operator === '/' ? left / right : left % right, node);
      default:
        return checkNumber(left ** right, node);
    }
  }

  private equals(left: FormulaValue, right: FormulaValue): boolean {
    if (isDateResult(left) && isDateResult(right)) {
      const { ctx } = this.env;
      const end = (value: DateValue) =>
        value.end ? startMs({ ...value, start: value.end }, ctx) : startMs(value, ctx);
      return startMs(left, ctx) === startMs(right, ctx) && end(left) === end(right);
    }
    if (typeof left === 'number' && typeof right === 'number') {
      return cleanNumber(left) === cleanNumber(right);
    }
    return left === right;
  }

  private compare(
    left: FormulaValue,
    right: FormulaValue,
    node: FormulaNode,
    operator: string,
  ): number | null {
    if (left === null || right === null) return null;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string') {
      return sortCollator(this.env.ctx.locale).compare(left, right);
    }
    if (typeof left === 'boolean' && typeof right === 'boolean')
      return Number(left) - Number(right);
    if (isDateResult(left) && isDateResult(right)) {
      return startMs(left, this.env.ctx) - startMs(right, this.env.ctx);
    }
    throw mismatch(node, operator, typeOf(left), right);
  }

  private call(
    node: Extract<FormulaNode, { type: 'call' }>,
    formula: CompiledFormula,
  ): FormulaValue {
    // `compileFormula` has checked the name; the switch's default guards trees built by hand.
    const name = findFunction(node.name)?.name ?? node.name;
    // Lazy forms: only the branches that matter are evaluated.
    if (name === 'if') {
      const [test, then, otherwise] = node.args as [FormulaNode, FormulaNode, FormulaNode?];
      if (truthy(this.run(test, formula))) return this.run(then, formula);
      return otherwise ? this.run(otherwise, formula) : null;
    }
    if (name === 'and') return node.args.every((arg) => truthy(this.run(arg, formula)));
    if (name === 'or') return node.args.some((arg) => truthy(this.run(arg, formula)));

    const args = node.args.map((arg) => this.run(arg, formula));
    const params: FormulaErrorParams = { name };
    const { ctx } = this.env;
    const number = (index: number): number | null => {
      const value = args[index] ?? null;
      if (value === null || typeof value === 'number') return value;
      throw mismatch(node.args[index] ?? node, name, 'number', value);
    };
    const date = (index: number): DateValue | null => {
      const value = args[index] ?? null;
      if (value === null || isDateResult(value)) return value;
      throw mismatch(node.args[index] ?? node, name, 'date', value);
    };
    const text = (index: number): string => this.text(args[index] ?? null);
    const unit = (index: number): DateUnit => {
      const found = dateUnit(text(index));
      const at = node.args[index] ?? node;
      if (!found) throw new FormulaError('invalidUnit', at.start, at.end, { unit: text(index) });
      return found;
    };
    const math = (fnImpl: (value: number) => number): FormulaValue => {
      const value = number(0);
      return value === null ? null : checkNumber(fnImpl(value), node);
    };
    const numbers = (): number[] =>
      args.map((_, index) => number(index)).filter((value): value is number => value !== null);

    switch (name) {
      // `not(x)` parses as the `not` operator, so it never gets here.
      case 'empty':
        return isEmptyResult(args[0] ?? null);

      case 'abs':
        return math(Math.abs);
      case 'floor':
        return math(Math.floor);
      case 'ceil':
        return math(Math.ceil);
      case 'sign':
        return math(Math.sign);
      case 'sqrt': {
        const value = number(0);
        if (value === null) return null;
        if (value < 0) throw new FormulaError('invalidNumber', node.start, node.end);
        return Math.sqrt(value);
      }
      case 'round': {
        const value = number(0);
        const digits = args.length > 1 ? number(1) : 0;
        if (value === null) return null;
        const places = Math.max(0, Math.min(10, Math.trunc(digits ?? 0)));
        const factor = 10 ** places;
        return cleanNumber(Math.round(value * factor) / factor);
      }
      case 'pow': {
        const base = number(0);
        const exponent = number(1);
        return base === null || exponent === null ? null : checkNumber(base ** exponent, node);
      }
      case 'min':
      case 'max':
      case 'sum': {
        const values = numbers();
        if (values.length === 0) return null;
        if (name === 'sum')
          return checkNumber(
            values.reduce((total, value) => total + value, 0),
            node,
          );
        return name === 'min' ? Math.min(...values) : Math.max(...values);
      }
      case 'toNumber': {
        const value = args[0] ?? null;
        if (value === null || typeof value === 'number') return value;
        if (typeof value === 'boolean') return value ? 1 : 0;
        if (typeof value === 'string') return parseNumberText(value)?.value ?? null;
        return startMs(value, ctx);
      }

      case 'concat':
        return checkText(args.map((value) => this.text(value)).join(''), node);
      case 'format':
        return text(0);
      case 'length':
        return Array.from(text(0)).length;
      case 'lower':
        return text(0).toLocaleLowerCase(ctx.locale);
      case 'upper':
        return text(0).toLocaleUpperCase(ctx.locale);
      case 'trim':
        return text(0).trim();
      case 'contains':
      case 'startsWith':
      case 'endsWith': {
        const haystack = text(0).toLocaleLowerCase(ctx.locale);
        const needle = text(1).toLocaleLowerCase(ctx.locale);
        if (name === 'contains') return haystack.includes(needle);
        return name === 'startsWith' ? haystack.startsWith(needle) : haystack.endsWith(needle);
      }
      case 'replace': {
        const search = text(1);
        const source = text(0);
        if (search === '') return source;
        return checkText(source.split(search).join(text(2)), node);
      }
      case 'slice': {
        const chars = Array.from(text(0));
        const start = number(1) ?? 0;
        const end = args.length > 2 ? (number(2) ?? chars.length) : chars.length;
        return chars.slice(Math.trunc(start), Math.trunc(end)).join('');
      }

      case 'now':
        return { start: new Date(ctx.now).toISOString(), includeTime: true };
      case 'today':
        return { start: todayKey(ctx.now, ctx.timeZone) };
      case 'dateAdd':
      case 'dateSubtract': {
        const value = date(0);
        const amount = number(1);
        const units = unit(2);
        if (value === null || amount === null) return null;
        return addToDate(value, name === 'dateAdd' ? amount : -amount, units, ctx);
      }
      case 'dateBetween': {
        const later = date(0);
        const earlier = date(1);
        const units = unit(2);
        if (later === null || earlier === null) return null;
        return difference(later, earlier, units, ctx);
      }
      case 'dateRange': {
        const from = date(0);
        const to = date(1);
        if (from === null || to === null) return null;
        if (!!from.includeTime !== !!to.includeTime) throw mismatch(node, name, 'date', to);
        const [first, last] = startMs(from, ctx) <= startMs(to, ctx) ? [from, to] : [to, from];
        const result: DateValue = { ...first, end: last.start };
        return result;
      }
      case 'start':
      case 'end': {
        const value = date(0);
        if (value === null) return null;
        const { end: _end, ...rest } = value;
        return name === 'start' || !value.end ? rest : { ...rest, start: value.end };
      }
      case 'formatDate': {
        const value = date(0);
        return value === null ? null : formatDateValue(value, undefined, ctx);
      }
      case 'year':
      case 'month':
      case 'day':
      case 'weekday':
      case 'hour':
      case 'minute': {
        const value = date(0);
        if (value === null) return null;
        const clock = wallClock(value, ctx);
        const parts = parseDayKey(clock.day);
        if (!parts) return null;
        if (name === 'year') return parts.year;
        if (name === 'month') return parts.month;
        if (name === 'day') return parts.day;
        if (name === 'weekday') return ((dayOfWeek(clock.day) + 6) % 7) + 1;
        return name === 'hour' ? clock.hour : clock.minute;
      }
      case 'timestamp': {
        const value = date(0);
        return value === null ? null : startMs(value, ctx);
      }
      case 'fromTimestamp': {
        const ms = number(0);
        if (ms === null) return null;
        const instant = new Date(ms);
        if (Number.isNaN(instant.getTime()))
          throw new FormulaError('invalidNumber', node.start, node.end);
        return { start: instant.toISOString(), includeTime: true };
      }
      default:
        throw new FormulaError('unknownFunction', node.start, node.end, params);
    }
  }
}
