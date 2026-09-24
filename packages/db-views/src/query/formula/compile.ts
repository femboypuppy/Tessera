import type { PropertyDefinition } from '@tessera/core';
import { propertyKey, type CompiledFormula } from './evaluate';
import { findFunction } from './functions';
import { parseFormula, type FormulaNode } from './parse';
import { FormulaError, tokenize, type Token } from './tokens';

export type CompileResult =
  | { ok: true; formula: CompiledFormula & { formulas: readonly string[] } }
  | { ok: false; error: FormulaError };

/**
 * Parses a formula and checks it against the database's properties: every function exists and
 * gets the right number of arguments, and every `prop("Name")` names a property (ignoring case).
 *
 * @example
 * const result = compileFormula('prop("Pages") / 30', properties);
 * if (!result.ok) console.log(result.error.code); // 'unknownProperty', …
 */
export function compileFormula(
  expression: string,
  properties: readonly PropertyDefinition[],
): CompileResult {
  const byName = new Map<string, PropertyDefinition>();
  for (const property of properties) {
    const key = propertyKey(property.name);
    if (!byName.has(key)) byName.set(key, property);
  }
  const references = new Map<string, string>();
  const formulas = new Set<string>();
  let usesClock = false;
  let usesRelations = false;
  if (expression.trim() === '') {
    return {
      ok: true,
      formula: { expression, root: null, references, usesClock, usesRelations, formulas: [] },
    };
  }
  try {
    const root = parseFormula(expression);
    const visit = (node: FormulaNode): void => {
      switch (node.type) {
        case 'property': {
          const property = byName.get(propertyKey(node.name));
          if (!property) {
            throw new FormulaError('unknownProperty', node.start, node.end, { name: node.name });
          }
          references.set(propertyKey(node.name), property.id);
          if (property.type === 'relation') usesRelations = true;
          if (property.type === 'formula') formulas.add(property.id);
          return;
        }
        case 'unary':
          visit(node.operand);
          return;
        case 'binary':
          visit(node.left);
          visit(node.right);
          return;
        case 'conditional':
          visit(node.test);
          visit(node.then);
          visit(node.otherwise);
          return;
        case 'call': {
          const fn = findFunction(node.name);
          if (!fn) {
            throw new FormulaError('unknownFunction', node.start, node.end, { name: node.name });
          }
          if (node.args.length < fn.min || node.args.length > fn.max) {
            throw new FormulaError('argumentCount', node.start, node.end, {
              name: fn.name,
              min: fn.min,
              max: Number.isFinite(fn.max) ? fn.max : -1,
            });
          }
          if (fn.name === 'now' || fn.name === 'today') usesClock = true;
          node.args.forEach(visit);
          return;
        }
        default:
          return;
      }
    };
    visit(root);
    return {
      ok: true,
      formula: { expression, root, references, usesClock, usesRelations, formulas: [...formulas] },
    };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, error };
    throw error;
  }
}

function quote(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Rewrites `prop("Old")` references after a property is renamed, keeping everything else as
 * written. Formulas that don't parse are returned unchanged.
 *
 * @example
 * renamePropertyInFormula('prop("Pages") / 30', 'Pages', 'Page count'); // 'prop("Page count") / 30'
 */
export function renamePropertyInFormula(expression: string, from: string, to: string): string {
  let tokens: Token[];
  try {
    tokens = tokenize(expression);
  } catch {
    return expression;
  }
  const key = propertyKey(from);
  let result = '';
  let copied = 0;
  for (let i = 0; i + 3 < tokens.length; i += 1) {
    const [name, open, arg, close] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    if (
      name?.kind === 'identifier' &&
      name.text.toLowerCase() === 'prop' &&
      open?.kind === 'open' &&
      arg?.kind === 'string' &&
      close?.kind === 'close' &&
      propertyKey(arg.text) === key
    ) {
      result += expression.slice(copied, arg.start) + quote(to);
      copied = arg.end;
    }
  }
  return result + expression.slice(copied);
}
