import { toError } from '@tessera/core';

/**
 * Like core's `toError`, but keeps the name and message of error-like objects that are not
 * `Error` instances (a `DOMException` from another realm, such as IndexedDB errors in some
 * environments), so quota errors stay recognisable.
 */
export function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') {
    const { name, message } = value as { name?: unknown; message?: unknown };
    if (typeof message === 'string') {
      const error = new Error(message);
      if (typeof name === 'string' && name) error.name = name;
      return error;
    }
  }
  return toError(value);
}
