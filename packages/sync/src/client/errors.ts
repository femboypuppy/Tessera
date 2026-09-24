/**
 * A failed server call. `status` 0 means the server couldn't be reached (offline, wrong
 * address, or the browser blocked it: CORS). In its own module so code that only checks errors
 * doesn't load the API client and its schemas.
 */
export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}
