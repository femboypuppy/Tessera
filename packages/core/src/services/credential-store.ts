/** A server that holds a saved sign-in token (never the token itself). */
export interface SavedCredential {
  /** The server's origin (`https://notes.example.com`). */
  server: string;
  /** Epoch milliseconds of the last `set`. */
  savedAt: number;
}

/**
 * Sign-in tokens for Tessera servers, keyed by server origin. Browsers sign in with httpOnly
 * cookies and need none of this; the desktop app gets bearer tokens and keeps them in the OS
 * keychain (`@tessera/desktop`, priority 100). Implementations normalize `server` to its origin.
 *
 * @example
 * await ctx.services.credentialStore.set('https://notes.example.com', token);
 * const token = await ctx.services.credentialStore.get('https://notes.example.com/sync');
 */
export interface CredentialStore {
  get(server: string): Promise<string | null>;
  set(server: string, token: string): Promise<void>;
  delete(server: string): Promise<void>;
  /** Servers with a saved token, newest first. */
  list(): Promise<SavedCredential[]>;
}

/** The origin of a server URL, or the trimmed input when it isn't a URL. */
export function credentialKey(server: string): string {
  try {
    return new URL(server).origin;
  } catch {
    return server.trim();
  }
}

/** In-memory {@link CredentialStore} (priority 0): tokens last until the app closes. */
export class MemoryCredentialStore implements CredentialStore {
  private readonly tokens = new Map<string, { token: string; savedAt: number }>();

  async get(server: string): Promise<string | null> {
    return this.tokens.get(credentialKey(server))?.token ?? null;
  }

  async set(server: string, token: string): Promise<void> {
    this.tokens.set(credentialKey(server), { token, savedAt: Date.now() });
  }

  async delete(server: string): Promise<void> {
    this.tokens.delete(credentialKey(server));
  }

  async list(): Promise<SavedCredential[]> {
    return [...this.tokens]
      .map(([server, { savedAt }]) => ({ server, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }
}
