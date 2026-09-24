import { isJsonValue, type JsonValue } from '@tessera/core';
import { parseDocument, stringify } from 'yaml';

/** Converts anything YAML produced into JSON (dates to ISO strings, non-finite numbers to null). */
function toJson(value: unknown, depth = 0): JsonValue {
  if (depth > 32) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) return value.map((item) => toJson(item, depth + 1));
  if (value instanceof Map) {
    const record: Record<string, JsonValue> = {};
    for (const [key, item] of value) record[String(key)] = toJson(item, depth + 1);
    return record;
  }
  if (typeof value === 'object') {
    const record: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) record[key] = toJson(item, depth + 1);
    return record;
  }
  return String(value);
}

/** Result of {@link parseFrontmatter}. */
export interface FrontmatterResult {
  data: Record<string, JsonValue>;
  warnings: string[];
}

/**
 * Parses YAML frontmatter safely: the YAML 1.2 core schema (no custom tags, no timestamps), a cap
 * on aliases (no "billion laughs"), and JSON output. Invalid YAML yields `{}` and a warning.
 *
 * @example
 * parseFrontmatter('tags: [a, b]\naliases: Q3'); // { data: { tags: ['a', 'b'], aliases: 'Q3' }, warnings: [] }
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  if (!source.trim()) return { data: {}, warnings: [] };
  try {
    const document = parseDocument(source, {
      schema: 'core',
      uniqueKeys: false,
      prettyErrors: false,
      strict: false,
    });
    if (document.errors.length) {
      return {
        data: {},
        warnings: [`Invalid frontmatter: ${document.errors[0]?.message ?? 'syntax error'}`],
      };
    }
    const value = toJson(document.toJS({ maxAliasCount: 100 }));
    if (value === null) return { data: {}, warnings: [] };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { data: {}, warnings: ['Frontmatter is not a set of properties'] };
    }
    return { data: value, warnings: [] };
  } catch (error) {
    return {
      data: {},
      warnings: [`Invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/** Serializes properties as YAML frontmatter content (without the `---` fences). */
export function stringifyFrontmatter(data: Record<string, JsonValue>): string {
  const clean: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isJsonValue(value)) clean[key] = value;
  }
  return stringify(clean, { lineWidth: 0, schema: 'core' }).replace(/\n$/, '');
}
