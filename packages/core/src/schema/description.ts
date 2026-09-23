import type { Schema } from 'prosemirror-model';
import type { JsonValue } from '../json';
import { tesseraSchema } from './schema';
import { DOC_SCHEMA_VERSION } from './types';

/** One attribute in a {@link SchemaDescription}. */
export interface AttributeDescription {
  hasDefault: boolean;
  default: JsonValue;
}

/** One node type in a {@link SchemaDescription}. */
export interface NodeDescription {
  /** Content expression with whitespace normalized, or null for leaves. */
  content: string | null;
  /** Group names, sorted. */
  groups: string[];
  /** Allowed marks (`''` = none), or null for the ProseMirror default. */
  marks: string | null;
  inline: boolean;
  atom: boolean;
  code: boolean;
  /** prosemirror-tables role, or null. */
  tableRole: string | null;
  attrs: Record<string, AttributeDescription>;
}

/** One mark type in a {@link SchemaDescription}. */
export interface MarkDescription {
  attrs: Record<string, AttributeDescription>;
  /** Excluded marks, or null for the default (the mark excludes only itself). */
  excludes: string | null;
  inclusive: boolean;
  spanning: boolean;
  code: boolean;
}

/**
 * A machine-readable description of a ProseMirror schema: everything that decides whether a
 * document is valid (names, content expressions, groups, allowed marks, atoms, attributes and their
 * defaults, mark exclusion). Editing behavior (`defining`, `isolating`, `selectable`, DOM specs)
 * and ordering are deliberately left out.
 */
export interface SchemaDescription {
  version: number;
  topNode: string;
  nodes: Record<string, NodeDescription>;
  marks: Record<string, MarkDescription>;
}

function normalizeContent(expression: string | undefined): string | null {
  if (expression === undefined || expression.trim() === '') return null;
  return expression
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeAttrs(attrs: unknown): Record<string, AttributeDescription> {
  const result: Record<string, AttributeDescription> = {};
  if (!attrs || typeof attrs !== 'object') return result;
  for (const name of Object.keys(attrs).sort()) {
    const spec = (attrs as Record<string, unknown>)[name];
    const hasDefault = !!spec && typeof spec === 'object' && 'default' in spec;
    const value = hasDefault ? (spec as { default: unknown }).default : null;
    result[name] = { hasDefault, default: value === undefined ? null : (value as JsonValue) };
  }
  return result;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Describes any ProseMirror schema. The editor's conformance test compares
 * `describeSchema(editor.schema)` with {@link SCHEMA_DESCRIPTION}.
 *
 * @example
 * expect(diffSchemaDescriptions(SCHEMA_DESCRIPTION, describeSchema(editor.schema))).toEqual([]);
 */
export function describeSchema(schema: Schema): SchemaDescription {
  const nodes: Record<string, NodeDescription> = {};
  for (const name of Object.keys(schema.nodes).sort()) {
    const type = schema.nodes[name];
    if (!type) continue;
    const spec = type.spec as Record<string, unknown>;
    nodes[name] = {
      content: normalizeContent(stringOrNull(spec.content) ?? undefined),
      groups: (stringOrNull(spec.group) ?? '').split(/\s+/).filter(Boolean).sort(),
      marks: stringOrNull(spec.marks),
      inline: type.isInline,
      atom: type.isAtom,
      code: spec.code === true,
      tableRole: stringOrNull(spec.tableRole),
      attrs: describeAttrs(spec.attrs),
    };
  }
  const marks: Record<string, MarkDescription> = {};
  for (const name of Object.keys(schema.marks).sort()) {
    const type = schema.marks[name];
    if (!type) continue;
    const spec = type.spec as Record<string, unknown>;
    marks[name] = {
      attrs: describeAttrs(spec.attrs),
      excludes: stringOrNull(spec.excludes),
      inclusive: spec.inclusive !== false,
      spanning: spec.spanning !== false,
      code: spec.code === true,
    };
  }
  return { version: DOC_SCHEMA_VERSION, topNode: schema.topNodeType.name, nodes, marks };
}

/** The description of the canonical schema. The contract every schema implementation must match. */
export const SCHEMA_DESCRIPTION: SchemaDescription = describeSchema(tesseraSchema);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffAttrs(
  where: string,
  expected: Record<string, AttributeDescription>,
  actual: Record<string, AttributeDescription>,
): string[] {
  const issues: string[] = [];
  for (const [name, spec] of Object.entries(expected)) {
    const other = actual[name];
    if (!other) issues.push(`${where}: missing attribute "${name}"`);
    else if (!same(spec, other)) {
      issues.push(
        `${where}: attribute "${name}" expected ${JSON.stringify(spec)}, got ${JSON.stringify(other)}`,
      );
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) issues.push(`${where}: unexpected attribute "${name}"`);
  }
  return issues;
}

/**
 * Lists every difference between two schema descriptions, as readable sentences. Empty when they
 * match.
 */
export function diffSchemaDescriptions(
  expected: SchemaDescription,
  actual: SchemaDescription,
): string[] {
  const issues: string[] = [];
  if (expected.topNode !== actual.topNode) {
    issues.push(`top node: expected "${expected.topNode}", got "${actual.topNode}"`);
  }
  for (const [name, node] of Object.entries(expected.nodes)) {
    const other = actual.nodes[name];
    if (!other) {
      issues.push(`missing node "${name}"`);
      continue;
    }
    for (const key of [
      'content',
      'groups',
      'marks',
      'inline',
      'atom',
      'code',
      'tableRole',
    ] as const) {
      if (!same(node[key], other[key])) {
        issues.push(
          `node "${name}": ${key} expected ${JSON.stringify(node[key])}, got ${JSON.stringify(other[key])}`,
        );
      }
    }
    issues.push(...diffAttrs(`node "${name}"`, node.attrs, other.attrs));
  }
  for (const name of Object.keys(actual.nodes)) {
    if (!(name in expected.nodes)) issues.push(`unexpected node "${name}"`);
  }
  for (const [name, mark] of Object.entries(expected.marks)) {
    const other = actual.marks[name];
    if (!other) {
      issues.push(`missing mark "${name}"`);
      continue;
    }
    for (const key of ['excludes', 'inclusive', 'spanning', 'code'] as const) {
      if (!same(mark[key], other[key])) {
        issues.push(
          `mark "${name}": ${key} expected ${JSON.stringify(mark[key])}, got ${JSON.stringify(other[key])}`,
        );
      }
    }
    issues.push(...diffAttrs(`mark "${name}"`, mark.attrs, other.attrs));
  }
  for (const name of Object.keys(actual.marks)) {
    if (!(name in expected.marks)) issues.push(`unexpected mark "${name}"`);
  }
  return issues;
}
