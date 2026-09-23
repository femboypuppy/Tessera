/** An error with an HTTP status and a stable code, safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = (message = 'Sign in to continue.') =>
  new HttpError(401, 'unauthenticated', message);
export const forbidden = (message = 'You don’t have access to this.') =>
  new HttpError(403, 'permission_denied', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const invalid = (message: string, details?: unknown) =>
  new HttpError(400, 'invalid', message, details);
