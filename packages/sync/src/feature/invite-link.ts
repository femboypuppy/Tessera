const KEY = 'tessera:sync:invite';

/**
 * Invite links look like `https://server/?invite=<token>`. The shell navigates on startup and
 * drops the query, so the token is copied to session storage first (called while the app starts,
 * before anything renders).
 */
export function rememberInviteFromUrl(): void {
  try {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('invite');
    if (token && /^[\w-]{10,200}$/.test(token)) sessionStorage.setItem(KEY, token);
  } catch {
    // Storage disabled: the invite can still be pasted.
  }
}

/** The invite token this tab was opened with, if any. */
export function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The token of a pasted invite link (or of a bare token). */
export function inviteTokenFrom(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const token = url.searchParams.get('invite');
    return token && /^[\w-]{10,200}$/.test(token) ? token : null;
  } catch {
    return /^[\w-]{10,200}$/.test(value) ? value : null;
  }
}

/** The server an invite link points to (its origin). */
export function inviteServer(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.searchParams.get('invite') ? url.origin : null;
  } catch {
    return null;
  }
}
