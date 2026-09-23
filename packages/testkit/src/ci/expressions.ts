/**
 * A GitHub Actions expression evaluator (https://docs.github.com/actions/learn-github-actions/expressions),
 * for running workflows locally (`scripts/ci/local.ts`). It supports the whole operator set,
 * property access with `.`, `[...]` and `*` filters, and the functions the workflows use.
 *
 * Semantics follow Actions: `&&`/`||` return an operand, `==` compares strings case-insensitively
 * and coerces mismatched types to numbers, and `null`, `false`, `0`, `NaN` and `''` are falsy.
 */

export type ExpressionValue =
  null | boolean | number | string | ExpressionValue[] | { [key: string]: ExpressionValue };

/** Status of the job so far, for `success()`, `failure()` and `cancelled()`. */
export interface ExpressionStatus {
  success: boolean;
  failure: boolean;
  cancelled: boolean;
}

export interface ExpressionContext {
  /** Named contexts: `github`, `env`, `matrix`, `needs`, `steps`, `inputs`, `secrets`, … */
  contexts: Record<string, ExpressionValue>;
  status?: ExpressionStatus;
  /** For `hashFiles(...)`. Defaults to a constant. */
  hashFiles?: (patterns: string[]) => string;
}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

const OPERATORS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '<',
  '>',
  '!',
  '(',
  ')',
  '[',
  ']',
  '.',
  ',',
  '*',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "'") {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= source.length) throw new SyntaxError(`Unterminated string in: ${source}`);
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += source[i];
        i += 1;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    const number = /^(?:0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
    if (number && (char !== '-' || tokens.length === 0 || tokens.at(-1)?.kind === 'op')) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      tokens.push({ kind: 'op', value: op });
      i += op.length;
      continue;
    }
    throw new SyntaxError(`Unexpected "${char}" in: ${source}`);
  }
  return tokens;
}

type Node =
  | { type: 'literal'; value: ExpressionValue }
  | { type: 'context'; name: string }
  | { type: 'property'; object: Node; key: Node | '*' }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'not'; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node };

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
    this.tokens = tokenize(source);
  }

  parse(): Node {
    const node = this.or();
    if (this.index < this.tokens.length) this.fail('Unexpected token');
    return node;
  }

  private fail(message: string): never {
    throw new SyntaxError(`${message} at token ${this.index} in: ${this.source}`);
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private takeOp(value: string): boolean {
    const token = this.peek();
    if (token?.kind === 'op' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expectOp(value: string): void {
    if (!this.takeOp(value)) this.fail(`Expected "${value}"`);
  }

  private or(): Node {
    let left = this.and();
    while (this.takeOp('||')) left = { type: 'binary', op: '||', left, right: this.and() };
    return left;
  }

  private and(): Node {
    let left = this.comparison();
    while (this.takeOp('&&')) left = { type: 'binary', op: '&&', left, right: this.comparison() };
    return left;
  }

  private comparison(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(token.value)) {
        this.index += 1;
        left = { type: 'binary', op: token.value, left, right: this.unary() };
      } else return left;
    }
  }

  private unary(): Node {
    if (this.takeOp('!')) return { type: 'not', operand: this.unary() };
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      if (this.takeOp('.')) {
        if (this.takeOp('*')) node = { type: 'property', object: node, key: '*' };
        else {
          const token = this.peek();
          if (token?.kind !== 'ident') this.fail('Expected a property name');
          this.index += 1;
          node = { type: 'property', object: node, key: { type: 'literal', value: token.value } };
        }
      } else if (this.takeOp('[')) {
        const key = this.takeOp('*') ? '*' : this.or();
        this.expectOp(']');
        node = { type: 'property', object: node, key };
      } else return node;
    }
  }

  private primary(): Node {
    const token = this.peek();
    if (!token) this.fail('Unexpected end');
    this.index += 1;
    if (token.kind === 'number' || token.kind === 'string') {
      return { type: 'literal', value: token.value };
    }
    if (token.kind === 'op') {
      if (token.value === '(') {
        const inner = this.or();
        this.expectOp(')');
        return inner;
      }
      this.fail(`Unexpected "${token.value}"`);
    }
    if (token.value === 'true' || token.value === 'false') {
      return { type: 'literal', value: token.value === 'true' };
    }
    if (token.value === 'null') return { type: 'literal', value: null };
    if (this.takeOp('(')) {
      const args: Node[] = [];
      if (!this.takeOp(')')) {
        do args.push(this.or());
        while (this.takeOp(','));
        this.expectOp(')');
      }
      return { type: 'call', name: token.value.toLowerCase(), args };
    }
    return { type: 'context', name: token.value };
  }
}

/** Actions' truthiness. */
export function isTruthy(value: ExpressionValue | undefined): boolean {
  if (value === null || value === undefined || value === false || value === '') return false;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  return true;
}

function toNumber(value: ExpressionValue | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.trim() === '') return 0;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? Number.NaN : parsed;
  }
  return Number.NaN;
}

/** Converts a value to the string Actions interpolates (`null` → '', objects → JSON). */
export function toExpressionString(value: ExpressionValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function compare(
  op: string,
  left: ExpressionValue | undefined,
  right: ExpressionValue | undefined,
): boolean {
  const l = left ?? null;
  const r = right ?? null;
  if (op === '==' || op === '!=') {
    let equal: boolean;
    if (typeof l === 'string' && typeof r === 'string') equal = l.toLowerCase() === r.toLowerCase();
    else if (typeof l === typeof r && (typeof l !== 'object' || l === null || r === null)) {
      equal = l === r;
    } else if (typeof l === 'object' && l !== null && typeof r === 'object' && r !== null) {
      equal = l === r;
    } else equal = toNumber(l) === toNumber(r);
    return op === '==' ? equal : !equal;
  }
  let a: string | number;
  let b: string | number;
  if (typeof l === 'string' && typeof r === 'string') {
    a = l.toLowerCase();
    b = r.toLowerCase();
  } else {
    a = toNumber(l);
    b = toNumber(r);
  }
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

function property(
  object: ExpressionValue | undefined,
  key: ExpressionValue | '*',
): ExpressionValue {
  if (key === '*') {
    if (Array.isArray(object)) return object;
    if (object && typeof object === 'object') return Object.values(object);
    return [];
  }
  if (Array.isArray(object)) {
    // A filter result: apply the property to every element.
    if (typeof key === 'string' && !/^\d+$/.test(key)) {
      return object.map((item) => property(item, key));
    }
    return object[Math.trunc(toNumber(key))] ?? null;
  }
  if (object && typeof object === 'object') {
    const name = toExpressionString(key);
    const found = Object.keys(object).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    return found === undefined ? null : (object[found] ?? null);
  }
  return null;
}

function format(template: string, args: ExpressionValue[]): string {
  return template.replace(/\{\{|\}\}|\{(\d+)\}/g, (match, index: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    return toExpressionString(args[Number(index)]);
  });
}

function fromJSON(text: string): ExpressionValue {
  return JSON.parse(text) as ExpressionValue;
}

function evaluateNode(node: Node, context: ExpressionContext): ExpressionValue {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'context': {
      const key = Object.keys(context.contexts).find(
        (name) => name.toLowerCase() === node.name.toLowerCase(),
      );
      return key === undefined ? null : (context.contexts[key] ?? null);
    }
    case 'property':
      return property(
        evaluateNode(node.object, context),
        node.key === '*' ? '*' : evaluateNode(node.key, context),
      );
    case 'not':
      return !isTruthy(evaluateNode(node.operand, context));
    case 'binary': {
      if (node.op === '&&') {
        const left = evaluateNode(node.left, context);
        return isTruthy(left) ? evaluateNode(node.right, context) : left;
      }
      if (node.op === '||') {
        const left = evaluateNode(node.left, context);
        return isTruthy(left) ? left : evaluateNode(node.right, context);
      }
      return compare(node.op, evaluateNode(node.left, context), evaluateNode(node.right, context));
    }
    case 'call': {
      const args = node.args.map((arg) => evaluateNode(arg, context));
      const status = context.status ?? { success: true, failure: false, cancelled: false };
      const text = (index: number) => toExpressionString(args[index]);
      switch (node.name) {
        case 'success':
          return status.success;
        case 'failure':
          return status.failure;
        case 'cancelled':
          return status.cancelled;
        case 'always':
          return true;
        case 'contains': {
          const haystack = args[0];
          if (Array.isArray(haystack)) {
            return haystack.some((item) => compare('==', item, args[1] ?? null));
          }
          return text(0).toLowerCase().includes(text(1).toLowerCase());
        }
        case 'startswith':
          return text(0).toLowerCase().startsWith(text(1).toLowerCase());
        case 'endswith':
          return text(0).toLowerCase().endsWith(text(1).toLowerCase());
        case 'format':
          return format(text(0), args.slice(1));
        case 'join': {
          const separator = args.length > 1 ? text(1) : ',';
          const value = args[0];
          return Array.isArray(value)
            ? value.map((item) => toExpressionString(item)).join(separator)
            : text(0);
        }
        case 'tojson':
          return JSON.stringify(args[0] ?? null, null, 2);
        case 'fromjson':
          return fromJSON(text(0));
        case 'hashfiles':
          return (context.hashFiles ?? (() => 'local-hash'))(args.map((_, index) => text(index)));
        default:
          throw new SyntaxError(`Unknown function ${node.name}()`);
      }
    }
  }
}

/** Evaluates one expression (without the `${{ }}`). */
export function evaluateExpression(source: string, context: ExpressionContext): ExpressionValue {
  return evaluateNode(new Parser(source).parse(), context);
}

/** True when the expression calls a status function, so it runs even after failures. */
export function usesStatusFunction(source: string): boolean {
  return /\b(?:always|failure|cancelled|success)\s*\(/i.test(source);
}

/**
 * Evaluates an `if:` value: `${{ }}` is optional, and without a status function the condition
 * implicitly requires `success()`.
 */
export function evaluateCondition(
  condition: string | boolean | undefined,
  context: ExpressionContext,
): boolean {
  if (condition === undefined) return (context.status ?? { success: true }).success;
  if (typeof condition === 'boolean') return condition;
  const trimmed = condition.trim();
  const inner = /^\$\{\{([\s\S]*)\}\}$/.exec(trimmed)?.[1] ?? trimmed;
  const passes = isTruthy(evaluateExpression(inner, context));
  if (usesStatusFunction(inner)) return passes;
  return (context.status ?? { success: true }).success && passes;
}

/** Replaces every `${{ expression }}` in a string with the value's string form. */
export function interpolate(text: string, context: ExpressionContext): string {
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, source: string) =>
    toExpressionString(evaluateExpression(source, context)),
  );
}
