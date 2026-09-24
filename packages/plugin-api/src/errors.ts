import type { PluginPermission } from './permissions';

/** Why an API call failed. */
export type PluginErrorCode =
  /** The user didn't grant the permission this call needs (see `error.permission`). */
  | 'permission_denied'
  /** The page, database, row, panel or block doesn't exist. */
  | 'not_found'
  /** The input was invalid (too large, wrong shape, unknown option…). */
  | 'invalid'
  /** The call isn't allowed right now (a read-only block, a registration outside `activate`…). */
  | 'invalid_operation'
  /** Too many calls at once, or the host is shutting the plugin down. */
  | 'unavailable'
  /** The host didn't answer in time. */
  | 'timeout'
  | 'conflict'
  | 'aborted'
  | 'internal';

const CODES = new Set<string>([
  'permission_denied',
  'not_found',
  'invalid',
  'invalid_operation',
  'unavailable',
  'timeout',
  'conflict',
  'aborted',
  'internal',
]);

/** Returns true when `value` is a known {@link PluginErrorCode}. */
export function isPluginErrorCode(value: unknown): value is PluginErrorCode {
  return typeof value === 'string' && CODES.has(value);
}

/**
 * True for any error the API rejected with. Errors come from the sandbox runtime, not from your
 * bundle's copy of the SDK, so this checks their shape (`name` and `code`) instead of the class.
 */
export function isPluginError(value: unknown): value is PluginError {
  return (
    value instanceof Error &&
    value.name === 'PluginError' &&
    isPluginErrorCode((value as { code?: unknown }).code)
  );
}

/**
 * The error every API call rejects with. `message` is written for people: show it as is.
 * `instanceof PluginError` works for errors created by the sandbox runtime too.
 *
 * @example
 * try {
 *   await api.pages.get(pageId);
 * } catch (error) {
 *   if (error instanceof PluginError && error.code === 'permission_denied') showHint(error.message);
 * }
 */
export class PluginError extends Error {
  readonly code: PluginErrorCode;
  /** The missing permission, for `permission_denied`. */
  readonly permission?: PluginPermission;

  constructor(code: PluginErrorCode, message: string, permission?: PluginPermission) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    if (permission) this.permission = permission;
  }

  static override [Symbol.hasInstance](value: unknown): boolean {
    return isPluginError(value);
  }
}
