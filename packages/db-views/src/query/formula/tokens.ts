/**
 * Tokens of the formula language, and the error every stage of it throws. Pure and small: the
 * tokenizer reads the text once, left to right, and never uses regular expressions built from
 * user input.
 */

/** Why a formula can't be compiled or evaluated; the UI translates `formulaError_<code>`. */
export type FormulaErrorCode =
  | 'unexpectedCharacter'
  | 'unterminatedString'
  | 'unexpectedToken'
  | 'unexpectedEnd'
  | 'tooDeep'
  | 'unknownFunction'
  | 'argumentCount'
  | 'propertyName'
  | 'unknownProperty'
  | 'typeMismatch'
  | 'divisionByZero'
  | 'invalidNumber'
  | 'invalidUnit'
  | 'textTooLong'
  | 'circular'
  | 'tooComplex';

/** Values for the message placeholders (function names, types, counts). */
export type FormulaErrorParams = Readonly<Record<string, string | number>>;

/** A compile or evaluation error with the span of the formula it points at. */
export class FormulaError extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    /** Offsets in the expression (end exclusive); 0 and 0 when it has no place. */
    readonly start: number,
    readonly end: number,
    readonly params: FormulaErrorParams = {},
  ) {
    super(`${code} at ${start}`);
    this.name = 'FormulaError';
  }
}

export type TokenKind =
  'number' | 'string' | 'identifier' | 'operator' | 'open' | 'close' | 'comma' | 'end';

export interface Token {
  kind: TokenKind;
  /** The operator or identifier as written, the decoded text of a string. */
  text: string;
  /** The value of a number token. */
  number: number;
  start: number;
  end: number;
}

/** Operators, longest first so `<=` wins over `<`. */
const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '=',
  '!',
  '?',
  ':',
] as const;

/** Opening quote → closing quote. Curly quotes are accepted (text pasted from documents). */
const QUOTES: Readonly<Record<string, string>> = { '"': '"', "'": "'", '“': '”', '‘': '’' };

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
  return char === '_' || /\p{L}/u.test(char);
}

function isIdentifierPart(char: string): boolean {
  return char === '_' || /[\p{L}\p{N}]/u.test(char);
}

function readNumber(source: string, start: number): Token {
  let i = start;
  while (isDigit(source[i] ?? '')) i += 1;
  if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
    i += 1;
    while (isDigit(source[i] ?? '')) i += 1;
  }
  const exponent = source[i];
  if (exponent === 'e' || exponent === 'E') {
    let j = i + 1;
    if (source[j] === '+' || source[j] === '-') j += 1;
    if (isDigit(source[j] ?? '')) {
      while (isDigit(source[j] ?? '')) j += 1;
      i = j;
    }
  }
  const text = source.slice(start, i);
  return { kind: 'number', text, number: Number(text), start, end: i };
}

function readString(source: string, start: number, close: string): Token {
  let text = '';
  let i = start + 1;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (char === close) return { kind: 'string', text, number: 0, start, end: i + 1 };
    if (char === '\\' && i + 1 < source.length) {
      const next = source[i + 1] ?? '';
      text += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    text += char;
    i += 1;
  }
  throw new FormulaError('unterminatedString', start, source.length);
}

/**
 * Splits a formula into tokens, ending with an `end` token.
 *
 * @example
 * tokenize('prop("Pages") / 30').map((token) => token.text); // ['prop', '(', 'Pages', ')', '/', '30', '']
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (/\s/u.test(char)) {
      i += 1;
      continue;
    }
    if (isDigit(char) || (char === '.' && isDigit(source[i + 1] ?? ''))) {
      const token = readNumber(source, i);
      tokens.push(token);
      i = token.end;
      continue;
    }
    const close = QUOTES[char];
    if (close) {
      const token = readString(source, i, close);
      tokens.push(token);
      i = token.end;
      continue;
    }
    if (isIdentifierStart(char)) {
      let j = i + 1;
      while (j < source.length && isIdentifierPart(source[j] ?? '')) j += 1;
      tokens.push({ kind: 'identifier', text: source.slice(i, j), number: 0, start: i, end: j });
      i = j;
      continue;
    }
    if (char === '(' || char === ')' || char === ',') {
      tokens.push({
        kind: char === '(' ? 'open' : char === ')' ? 'close' : 'comma',
        text: char,
        number: 0,
        start: i,
        end: i + 1,
      });
      i += 1;
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (operator) {
      tokens.push({
        kind: 'operator',
        text: operator,
        number: 0,
        start: i,
        end: i + operator.length,
      });
      i += operator.length;
      continue;
    }
    throw new FormulaError('unexpectedCharacter', i, i + 1, { character: char });
  }
  tokens.push({ kind: 'end', text: '', number: 0, start: source.length, end: source.length });
  return tokens;
}
