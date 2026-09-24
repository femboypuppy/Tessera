import { FormulaError, tokenize, type Token } from './tokens';

/**
 * The formula parser: text → syntax tree. A Pratt parser over the tokens, with the usual
 * precedence (lowest first): `? :`, `or`, `and`, `==` `!=`, `<` `<=` `>` `>=`, `+` `-`,
 * `*` `/` `%`, prefix `-` and `not`, `^` (right-associative, so `-2^2` is -4).
 */

export type BinaryOperator =
  '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

interface Span {
  start: number;
  end: number;
}

export type FormulaNode =
  | (Span & { type: 'number'; value: number })
  | (Span & { type: 'string'; value: string })
  | (Span & { type: 'boolean'; value: boolean })
  /** `prop("Name")`: the value of another property of the same row. */
  | (Span & { type: 'property'; name: string })
  | (Span & { type: 'unary'; operator: '-' | 'not'; operand: FormulaNode })
  | (Span & { type: 'binary'; operator: BinaryOperator; left: FormulaNode; right: FormulaNode })
  | (Span & { type: 'conditional'; test: FormulaNode; then: FormulaNode; otherwise: FormulaNode })
  | (Span & { type: 'call'; name: string; args: FormulaNode[] });

/** How deep parentheses and prefix operators may nest while parsing. */
export const MAX_FORMULA_DEPTH = 64;

/** How deep the syntax tree may get (long `a + b + c + …` chains nest without parentheses). */
export const MAX_TREE_DEPTH = 256;

const BINARY: Readonly<Record<string, { operator: BinaryOperator; power: number }>> = {
  or: { operator: 'or', power: 2 },
  '||': { operator: 'or', power: 2 },
  and: { operator: 'and', power: 3 },
  '&&': { operator: 'and', power: 3 },
  '==': { operator: '==', power: 4 },
  '=': { operator: '==', power: 4 },
  '!=': { operator: '!=', power: 4 },
  '<': { operator: '<', power: 5 },
  '<=': { operator: '<=', power: 5 },
  '>': { operator: '>', power: 5 },
  '>=': { operator: '>=', power: 5 },
  '+': { operator: '+', power: 6 },
  '-': { operator: '-', power: 6 },
  '*': { operator: '*', power: 7 },
  '/': { operator: '/', power: 7 },
  '%': { operator: '%', power: 7 },
  '^': { operator: '^', power: 9 },
};

const CONDITIONAL_POWER = 1;
const PREFIX_POWER = 8;

/** Word operators and literals are case-insensitive: `AND`, `True`. */
function keyword(token: Token): string | null {
  if (token.kind !== 'identifier') return null;
  const word = token.text.toLowerCase();
  return ['and', 'or', 'not', 'true', 'false'].includes(word) ? word : null;
}

class Parser {
  private index = 0;
  private depth = 0;
  /** Depth of each subtree, so evaluation never recurses too deep. */
  private readonly depths = new WeakMap<FormulaNode, number>();

  constructor(private readonly tokens: readonly Token[]) {}

  /** Records a node's depth (one more than its deepest child) and enforces the limit. */
  private node<T extends FormulaNode>(node: T, ...children: FormulaNode[]): T {
    const depth = 1 + Math.max(0, ...children.map((child) => this.depths.get(child) ?? 1));
    if (depth > MAX_TREE_DEPTH) throw new FormulaError('tooDeep', node.start, node.end);
    this.depths.set(node, depth);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? (this.tokens[this.tokens.length - 1] as Token);
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index += 1;
    return token;
  }

  private unexpected(token: Token): FormulaError {
    return token.kind === 'end'
      ? new FormulaError('unexpectedEnd', token.start, token.end)
      : new FormulaError('unexpectedToken', token.start, token.end, { token: token.text });
  }

  private expect(kind: Token['kind'], text?: string): Token {
    const token = this.peek();
    if (token.kind !== kind || (text !== undefined && token.text !== text))
      throw this.unexpected(token);
    return this.next();
  }

  parseFormula(): FormulaNode {
    const node = this.parseExpression(0);
    const rest = this.peek();
    if (rest.kind !== 'end') throw this.unexpected(rest);
    return node;
  }

  private parseExpression(minPower: number): FormulaNode {
    this.depth += 1;
    if (this.depth > MAX_FORMULA_DEPTH) {
      const token = this.peek();
      throw new FormulaError('tooDeep', token.start, token.end);
    }
    let left = this.parsePrefix();
    for (;;) {
      const token = this.peek();
      if (token.kind === 'operator' && token.text === '?') {
        if (CONDITIONAL_POWER < minPower) break;
        this.next();
        const then = this.parseExpression(0);
        this.expect('operator', ':');
        const otherwise = this.parseExpression(CONDITIONAL_POWER);
        left = this.node(
          {
            type: 'conditional',
            test: left,
            then,
            otherwise,
            start: left.start,
            end: otherwise.end,
          },
          left,
          then,
          otherwise,
        );
        continue;
      }
      const word = keyword(token);
      const binary =
        token.kind === 'operator'
          ? BINARY[token.text]
          : word === 'and' || word === 'or'
            ? BINARY[word]
            : undefined;
      if (!binary || binary.power < minPower) break;
      this.next();
      // `^` is right-associative; the others associate to the left.
      const right = this.parseExpression(binary.operator === '^' ? binary.power : binary.power + 1);
      left = this.node(
        {
          type: 'binary',
          operator: binary.operator,
          left,
          right,
          start: left.start,
          end: right.end,
        },
        left,
        right,
      );
    }
    this.depth -= 1;
    return left;
  }

  private parsePrefix(): FormulaNode {
    const token = this.next();
    const word = keyword(token);
    if (token.kind === 'number') {
      return { type: 'number', value: token.number, start: token.start, end: token.end };
    }
    if (token.kind === 'string') {
      return { type: 'string', value: token.text, start: token.start, end: token.end };
    }
    if (word === 'true' || word === 'false') {
      return { type: 'boolean', value: word === 'true', start: token.start, end: token.end };
    }
    if (
      (token.kind === 'operator' && (token.text === '-' || token.text === '!')) ||
      word === 'not'
    ) {
      const operand = this.parseExpression(PREFIX_POWER);
      return this.node(
        {
          type: 'unary',
          operator: token.text === '-' ? '-' : 'not',
          operand,
          start: token.start,
          end: operand.end,
        },
        operand,
      );
    }
    if (token.kind === 'operator' && token.text === '+') {
      // A leading `+` changes nothing.
      return this.parseExpression(PREFIX_POWER);
    }
    if (token.kind === 'open') {
      const inner = this.parseExpression(0);
      const close = this.expect('close');
      return this.node({ ...inner, start: token.start, end: close.end }, inner);
    }
    if (token.kind === 'identifier' && this.peek().kind === 'open') return this.parseCall(token);
    throw this.unexpected(token);
  }

  private parseCall(name: Token): FormulaNode {
    this.expect('open');
    const args: FormulaNode[] = [];
    if (this.peek().kind !== 'close') {
      for (;;) {
        args.push(this.parseExpression(0));
        if (this.peek().kind !== 'comma') break;
        this.next();
      }
    }
    const close = this.expect('close');
    if (name.text.toLowerCase() === 'prop') {
      const [arg] = args;
      if (args.length !== 1 || arg?.type !== 'string') {
        throw new FormulaError('propertyName', name.start, close.end);
      }
      return { type: 'property', name: arg.value, start: name.start, end: close.end };
    }
    return this.node(
      { type: 'call', name: name.text, args, start: name.start, end: close.end },
      ...args,
    );
  }
}

/**
 * Parses a formula. Throws a {@link FormulaError} pointing at the problem.
 *
 * @example
 * parseFormula('if(prop("Done"), 1, 0)'); // { type: 'call', name: 'if', args: [...] }
 */
export function parseFormula(source: string): FormulaNode {
  return new Parser(tokenize(source)).parseFormula();
}
