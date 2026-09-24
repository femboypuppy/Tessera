import type { JsonValue, PropertyDefinition } from '@tessera/core';
import type { QueryContext, QueryRow } from '../types';
import { compileFormula, type CompileResult } from './compile';
import { FormulaEvaluation, type CompiledFormula, type FormulaEnvironment } from './evaluate';
import { FormulaError } from './tokens';
import type { FormulaValue } from './values';

/*
 * Formula values of rows. Views read cells through `readCell`, which reads formula results from
 * `row.formulas`; `withFormulaValues` fills that in. Rows keep their identity while nothing a
 * formula depends on changes, so memoized row components don't re-render.
 */

const compileCache = new Map<string, CompileResult>();
const MAX_COMPILE_CACHE = 500;

function compileCached(
  expression: string,
  properties: readonly PropertyDefinition[],
  propertiesKey: string,
): CompileResult {
  const key = `${propertiesKey}\u0000${expression}`;
  let result = compileCache.get(key);
  if (!result) {
    if (compileCache.size >= MAX_COMPILE_CACHE) compileCache.clear();
    result = compileFormula(expression, properties);
    compileCache.set(key, result);
  }
  return result;
}

/** What formulas can see of the properties: names, types and option names. */
function signatureOf(properties: readonly PropertyDefinition[]): string {
  return JSON.stringify(
    properties.map((property) => [
      property.id,
      property.name,
      property.type,
      property.options?.map((option) => [option.id, option.name]) ?? null,
      property.formula?.expression ?? null,
    ]),
  );
}

/** Compiled formulas of a database, and what evaluation needs. */
export interface FormulaSetup {
  env: FormulaEnvironment;
  /** Formula properties, in order. */
  formulas: readonly PropertyDefinition[];
  /** Compile errors by formula property ID. */
  errors: ReadonlyMap<string, FormulaError>;
  /** Some formula reads the clock (directly or through another formula). */
  usesClock: boolean;
  /** Some formula reads a relation (titles of other pages can change its results). */
  usesRelations: boolean;
  signature: string;
}

/** Compiles every formula property of a database (compiles are cached by expression). */
export function formulaSetup(
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
): FormulaSetup {
  const signature = signatureOf(properties);
  const byId = new Map(properties.map((property) => [property.id, property]));
  const compiled = new Map<string, (CompiledFormula & { formulas: readonly string[] }) | null>();
  const errors = new Map<string, FormulaError>();
  const formulas = properties.filter((property) => property.type === 'formula');
  for (const property of formulas) {
    const result = compileCached(property.formula?.expression ?? '', properties, signature);
    compiled.set(property.id, result.ok ? result.formula : null);
    if (!result.ok) errors.set(property.id, result.error);
  }
  // Flags hold through formulas that read other formulas.
  const reaches = (flag: 'usesClock' | 'usesRelations'): boolean => {
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const formula = compiled.get(id);
      return !!formula && (formula[flag] || formula.formulas.some(visit));
    };
    return formulas.some((property) => visit(property.id));
  };
  return {
    env: { ctx, byId, compiled: (id) => compiled.get(id) ?? null },
    formulas,
    errors,
    usesClock: reaches('usesClock'),
    usesRelations: reaches('usesRelations'),
    signature,
  };
}

/** The result of one formula for one row, or why it has none. */
export type FormulaOutcome = { value: FormulaValue } | { error: FormulaError };

/** Evaluates a formula property for a row. */
export function evaluateFormulaProperty(
  setup: FormulaSetup,
  propertyId: string,
  row: QueryRow,
): FormulaOutcome {
  const compileError = setup.errors.get(propertyId);
  if (compileError) return { error: compileError };
  try {
    return { value: new FormulaEvaluation(row, setup.env).property(propertyId) };
  } catch (error) {
    if (error instanceof FormulaError) return { error };
    throw error;
  }
}

const rowCache = new WeakMap<QueryRow, { key: string; row: QueryRow }>();

/**
 * Rows with their formula results in `formulas` (errors leave a cell empty). Returns the input
 * when the database has no formulas. Results are cached per row object: a row keeps its identity
 * until it changes, or the properties, the time zone, the locale or (for formulas that read the
 * clock) the minute change. Formulas that read relations are recomputed on every call.
 */
export function withFormulaValues<R extends QueryRow>(
  rows: readonly R[],
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
): readonly R[] {
  if (!properties.some((property) => property.type === 'formula')) return rows;
  const setup = formulaSetup(properties, ctx);
  const key = [
    setup.signature,
    ctx.timeZone,
    ctx.locale,
    setup.usesClock ? Math.floor(ctx.now / 60_000) : '',
  ].join('\u0000');
  return rows.map((row) => {
    if (!setup.usesRelations) {
      const cached = rowCache.get(row);
      if (cached?.key === key) return cached.row as R;
    }
    const evaluation = new FormulaEvaluation(row, setup.env);
    const formulas: Record<string, JsonValue> = {};
    for (const property of setup.formulas) {
      if (setup.errors.has(property.id)) continue;
      try {
        const value = evaluation.property(property.id);
        if (value !== null) formulas[property.id] = value as JsonValue;
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
      }
    }
    const next: R = { ...row, formulas };
    if (!setup.usesRelations) rowCache.set(row, { key, row: next });
    return next;
  });
}

/** A formula draft's results for the first rows, for the formula editor. */
export type FormulaPreview =
  | { ok: false; error: FormulaError }
  | { ok: true; results: Array<{ row: QueryRow; outcome: FormulaOutcome }> };

/**
 * Compiles a draft of a formula property's expression and evaluates it for a few rows, as if it
 * were saved (other formulas that read it see the draft).
 */
export function previewFormula(
  expression: string,
  propertyId: string,
  properties: readonly PropertyDefinition[],
  rows: readonly QueryRow[],
  ctx: QueryContext,
  count = 3,
): FormulaPreview {
  const draft = properties.map((property) =>
    property.id === propertyId ? { ...property, formula: { expression } } : property,
  );
  const setup = formulaSetup(draft, ctx);
  const error = setup.errors.get(propertyId);
  if (error) return { ok: false, error };
  return {
    ok: true,
    results: rows.slice(0, count).map((row) => ({
      row,
      outcome: evaluateFormulaProperty(setup, propertyId, row),
    })),
  };
}
