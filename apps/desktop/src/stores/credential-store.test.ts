import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TauriBackend } from '../backend/tauri-backend';
import { resetDesktopRuntime } from '../runtime';
import { fakeTauri, installFakeTauri, uninstallFakeTauri } from '../testing/fake-tauri';
import { KeychainCredentialStore } from './credential-store';

describe('KeychainCredentialStore', () => {
  beforeEach(() => installFakeTauri());
  afterEach(() => {
    resetDesktopRuntime();
    uninstallFakeTauri();
  });

  it('keys tokens by server origin and lists servers without secrets', async () => {
    const store = new KeychainCredentialStore(new TauriBackend());
    await store.set('https://notes.example.com/app/', 'tsk_1');
    expect(await store.get('https://notes.example.com')).toBe('tsk_1');
    expect(fakeTauri().state.secrets).toEqual({ 'https://notes.example.com': 'tsk_1' });
    expect((await store.list()).map((entry) => entry.server)).toEqual([
      'https://notes.example.com',
    ]);
    await store.delete('https://notes.example.com/other');
    expect(await store.get('https://notes.example.com')).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('refuses bad servers and tokens', async () => {
    const store = new KeychainCredentialStore(new TauriBackend());
    await expect(store.set('ftp://example.com', 'x')).rejects.toThrow(/https/);
    await expect(store.set('not a url', 'x')).rejects.toThrow(/Invalid server/);
    await expect(store.set('https://example.com', '')).rejects.toThrow(/printable/);
    await expect(store.set('https://example.com', 'a\nb')).rejects.toThrow(/printable/);
  });
});
