/** Name of the session cookie (httpOnly, SameSite=Lax). */
export const SESSION_COOKIE = 'tessera_session';

/** Reads the session token from a `Cookie` header. */
export function readSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}
