import { TesseraError, type PluginPermission } from '@tessera/core';
import type { PluginErrorCode } from '@tessera/plugin-api';

/**
 * An error the host returns to a plugin. `message` is shown to people (plugins display it), so it
 * is translated and never contains internal details.
 */
export class PluginCallError extends Error {
  readonly code: PluginErrorCode;
  readonly permission?: PluginPermission;

  constructor(code: PluginErrorCode, message: string, permission?: PluginPermission) {
    super(message);
    this.name = 'PluginCallError';
    this.code = code;
    if (permission) this.permission = permission;
  }
}

/** Maps anything thrown by host code to what the plugin sees, and whether it was expected. */
export function toCallError(
  error: unknown,
  internalMessage: string,
): { error: PluginCallError; expected: boolean } {
  if (error instanceof PluginCallError) return { error, expected: true };
  if (error instanceof TesseraError && error.code !== 'internal') {
    const code: PluginErrorCode = error.code;
    return { error: new PluginCallError(code, error.message), expected: true };
  }
  if (error instanceof Error && error.name === 'PluginError') {
    // Errors from the shared SDK helpers (the query engine) carry a plugin error code already.
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string')
      return { error: new PluginCallError(code as PluginErrorCode, error.message), expected: true };
  }
  return { error: new PluginCallError('internal', internalMessage), expected: false };
}
