import { ValidationError } from '@tessera/core';
import type { DesktopBackend } from '../backend/backend';

/** A server the device holds a token for (no secret). */
export interface SavedServer {
  server: string;
  savedAt: number;
}

/**
 * Where sign-in tokens for Tessera servers are kept. The desktop implementation stores them in the
 * OS keychain (macOS Keychain, Windows Credential Manager, the Secret Service on Linux); only the
 * list of servers lives in a file. Tokens are keyed by the server's origin.
 *
 * This matches the `CredentialStore` service proposed in HANDOFF/desktop.md (contract change
 * request 1): once core has it, the desktop feature registers this class at priority 100 and the
 * sync feature's sign-in and Hocuspocus provider read tokens through
 * `ctx.services.credentialStore`.
 */
export class KeychainCredentialStore {
  constructor(private readonly backend: DesktopBackend) {}

  /** The origin tokens are keyed by (`https://notes.example.com`). */
  static origin(server: string): string {
    let url: URL;
    try {
      url = new URL(server);
    } catch {
      throw new ValidationError(`Invalid server URL: ${server}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new ValidationError(`Servers use https: ${server}`);
    return url.origin;
  }

  get(server: string): Promise<string | null> {
    return this.backend.getSecret(KeychainCredentialStore.origin(server));
  }

  async set(server: string, token: string): Promise<void> {
    // eslint-disable-next-line no-control-regex -- tokens with control characters are rejected
    if (!token || token.length > 8192 || /[\u0000-\u001f\u007f]/.test(token))
      throw new ValidationError('Tokens must be 1 to 8192 printable characters');
    await this.backend.setSecret(KeychainCredentialStore.origin(server), token);
  }

  delete(server: string): Promise<void> {
    return this.backend.deleteSecret(KeychainCredentialStore.origin(server));
  }

  list(): Promise<SavedServer[]> {
    return this.backend.listServers();
  }
}
