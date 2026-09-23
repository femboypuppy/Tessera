import {
  InvalidOperationError,
  NotFoundError,
  TesseraError,
  ValidationError,
  type TesseraErrorCode,
} from '@tessera/core';

const CODES = new Set<TesseraErrorCode>([
  'not_found',
  'invalid',
  'invalid_operation',
  'conflict',
  'permission_denied',
  'unavailable',
  'aborted',
  'internal',
]);

/**
 * Turns what a failed `invoke` rejects with (`{ code, message }` from `src-tauri/src/error.rs`, or
 * a string for errors raised by Tauri itself) into a `TesseraError` with a stable code.
 */
export function toDesktopError(value: unknown, command: string): TesseraError {
  if (value instanceof TesseraError) return value;
  if (typeof value === 'object' && value !== null && 'code' in value && 'message' in value) {
    const { code, message } = value as { code: unknown; message: unknown };
    const text = typeof message === 'string' ? message : String(message);
    if (code === 'not_found') {
      const error = new NotFoundError('Item', command);
      return Object.assign(error, { message: text });
    }
    if (code === 'invalid') return new ValidationError(text);
    if (code === 'invalid_operation') return new InvalidOperationError(text);
    if (typeof code === 'string' && CODES.has(code as TesseraErrorCode))
      return new TesseraError(code as TesseraErrorCode, text, { details: { command } });
    return new TesseraError('internal', text, { details: { command } });
  }
  const text = value instanceof Error ? value.message : String(value);
  // Tauri rejects with a plain string when a command is missing or not allowed for the window.
  const code: TesseraErrorCode = /not allowed|denied/i.test(text)
    ? 'permission_denied'
    : 'internal';
  return new TesseraError(code, `${command}: ${text}`, { cause: value, details: { command } });
}

/** True for a `not_found` error (a missing asset, an unknown workspace). */
export function isNotFound(error: unknown): boolean {
  return error instanceof TesseraError && error.code === 'not_found';
}
