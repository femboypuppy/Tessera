/** Limits for {@link inspectMessage}. */
export interface MessageLimits {
  /** Deepest nesting of objects and arrays. */
  depth: number;
  /** Most values (objects, arrays and primitives) in one message. */
  nodes: number;
  /** Most characters of all strings and keys together. */
  chars: number;
}

/** Why a message was refused. `cycle` also covers values shared between two places. */
export type MessageProblem = 'depth' | 'nodes' | 'chars' | 'type' | 'cycle';

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Checks, before any parsing, that a structured-cloned message is plain JSON-like data within
 * limits. Messages from plugins are untrusted: structured clone can carry cycles, huge strings,
 * Maps, Dates, typed arrays and deeply nested values. This walks the value iteratively (no
 * recursion to overflow) and stops at the first problem, so a hostile message costs at most
 * `nodes` steps.
 *
 * @example
 * inspectMessage(event.data, { depth: 48, nodes: 100_000, chars: 4_000_000 }); // null when fine
 */
export function inspectMessage(value: unknown, limits: MessageLimits): MessageProblem | null {
  let nodes = 0;
  let chars = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (stack.length) {
    const item = stack.pop();
    if (!item) break;
    const current = item.value;
    nodes += 1;
    if (nodes > limits.nodes) return 'nodes';
    if (current === null || current === undefined || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return 'type';
      continue;
    }
    if (typeof current === 'string') {
      chars += current.length;
      if (chars > limits.chars) return 'chars';
      continue;
    }
    if (typeof current !== 'object') return 'type';
    if (item.depth >= limits.depth) return 'depth';
    // Shared references are legal in structured clone but not in JSON; refuse them (and cycles).
    if (seen.has(current)) return 'cycle';
    seen.add(current);
    if (Array.isArray(current)) {
      if (nodes + current.length > limits.nodes) return 'nodes';
      for (let i = current.length - 1; i >= 0; i -= 1)
        stack.push({ value: current[i], depth: item.depth + 1 });
      continue;
    }
    if (!isPlainObject(current)) return 'type';
    const keys = Object.keys(current);
    if (nodes + keys.length > limits.nodes) return 'nodes';
    for (const key of keys) {
      chars += key.length;
      if (chars > limits.chars) return 'chars';
      stack.push({ value: (current as Record<string, unknown>)[key], depth: item.depth + 1 });
    }
  }
  return null;
}
