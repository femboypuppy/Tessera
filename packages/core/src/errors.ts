/** Machine-readable error codes used by every Tessera package. */
export type TesseraErrorCode =
  | 'not_found'
  | 'invalid'
  | 'invalid_operation'
  | 'conflict'
  | 'permission_denied'
  | 'unavailable'
  | 'aborted'
  | 'internal';

/**
 * Base class for errors thrown by Tessera code. Always carries a stable `code`, so callers can
 * branch on it without parsing messages.
 *
 * @example
 * try { movePage(ws, id, { parentId: id }); }
 * catch (e) { if (e instanceof TesseraError && e.code === 'invalid_operation') showToast(e.message); }
 */
export class TesseraError extends Error {
  readonly code: TesseraErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: TesseraErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TesseraError';
    this.code = code;
    if (options?.details) this.details = options.details;
  }
}

/** Thrown when a page, database, property, row, view or other entity does not exist. */
export class NotFoundError extends TesseraError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} "${id}" was not found`, { details: { entity, id } });
    this.name = 'NotFoundError';
  }
}

/** Thrown when input fails validation. `issues` lists every problem found. */
export class ValidationError extends TesseraError {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super('invalid', issues.length ? `${message}: ${issues.join('; ')}` : message, {
      details: { issues },
    });
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/** Thrown when an operation is not allowed in the current state (for example, a cyclic move). */
export class InvalidOperationError extends TesseraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('invalid_operation', message, details ? { details } : undefined);
    this.name = 'InvalidOperationError';
  }
}

/** Thrown when an operation was cancelled through an `AbortSignal`. */
export class AbortError extends TesseraError {
  constructor(message = 'The operation was cancelled') {
    super('aborted', message);
    this.name = 'AbortError';
  }
}

/** Throws an {@link AbortError} if `signal` is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}

/** Converts anything thrown into an `Error` with a readable message. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}
