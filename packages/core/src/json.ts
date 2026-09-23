/** A JSON primitive. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON-serializable value. Everything stored in Yjs maps outside of Y types must be one. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns true when `value` is a JSON value (plain objects, arrays, strings, finite numbers,
 * booleans and null), without cycles.
 *
 * @example
 * isJsonValue({ a: 1 }); // true
 * isJsonValue(new Date()); // false
 */
export function isJsonValue(value: unknown, seen: Set<unknown> = new Set()): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (seen.has(value)) return false;
      seen.add(value);
      const ok = Array.isArray(value)
        ? value.every((item) => isJsonValue(item, seen))
        : isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, seen));
      seen.delete(value);
      return ok;
    }
    default:
      return false;
  }
}

/** Returns true when `value` is a plain JSON object (not an array or null). */
export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value);
}

/** Deep structural equality for JSON values. Object key order is ignored. */
export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const aKeys = Object.keys(ao);
  if (aKeys.length !== Object.keys(bo).length) return false;
  return aKeys.every((key) => Object.hasOwn(bo, key) && jsonEqual(ao[key], bo[key]));
}

/** Deep-clones a JSON value. */
export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}
