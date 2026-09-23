import type * as Y from 'yjs';
import { isJsonValue, type JsonValue } from '../json';
import {
  getWorkspaceSetting,
  listWorkspaceSettingKeys,
  observeWorkspaceSettings,
  setWorkspaceSetting,
} from '../model/workspace-doc';

/**
 * A key-value settings store. Keys are namespaced by feature: `<featureId>.<name>`
 * (`editor.spellcheck`, `backlinks.showFooter`); the shell uses `shell.*` and `user.*`.
 * `AppContext.settings.device` is per device (localStorage); `AppContext.settings.workspace` is
 * shared with collaborators (the workspace doc).
 *
 * @example
 * const showFooter = ctx.settings.workspace.get('backlinks.showFooter') ?? false;
 * ctx.settings.device.set('editor.spellcheck', true);
 */
export interface SettingsStore {
  get(key: string): JsonValue | undefined;
  /** `undefined` deletes the key. */
  set(key: string, value: JsonValue | undefined): void;
  keys(prefix?: string): string[];
  /** Called with the changed key (including changes from other tabs or collaborators). */
  subscribe(listener: (key: string) => void): () => void;
}

/** Well-known settings keys used by the shell. */
export const SETTING_KEYS = {
  theme: 'shell.theme',
  language: 'shell.language',
  sidebarOpen: 'shell.sidebarOpen',
  sidebarWidth: 'shell.sidebarWidth',
  userId: 'user.id',
  userName: 'user.name',
  userColor: 'user.color',
} as const;

/** In-memory {@link SettingsStore}. */
export class MemorySettingsStore implements SettingsStore {
  private readonly values = new Map<string, JsonValue>();
  private readonly listeners = new Set<(key: string) => void>();

  constructor(initial: Record<string, JsonValue> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  get(key: string): JsonValue | undefined {
    return this.values.get(key);
  }

  set(key: string, value: JsonValue | undefined): void {
    if (value === undefined) this.values.delete(key);
    else if (!isJsonValue(value)) throw new TypeError(`Setting "${key}" must be a JSON value`);
    else this.values.set(key, value);
    for (const listener of [...this.listeners]) listener(key);
  }

  keys(prefix = ''): string[] {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  subscribe(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Prefix of device settings in localStorage. `apps/web/public/theme-init.js` relies on it. */
export const DEVICE_SETTINGS_PREFIX = 'tessera:device:';

/**
 * {@link SettingsStore} backed by `localStorage` (JSON values under `tessera:device:<key>`), with
 * changes from other tabs. Falls back to memory when storage is unavailable or full.
 */
export class LocalStorageSettingsStore implements SettingsStore {
  private readonly memory = new MemorySettingsStore();
  private readonly listeners = new Set<(key: string) => void>();
  private readonly storage: Storage | null;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(this.prefix)) this.emit(event.key.slice(this.prefix.length));
  };

  constructor(private readonly prefix: string = DEVICE_SETTINGS_PREFIX) {
    let storage: Storage | null = null;
    try {
      storage = typeof localStorage === 'undefined' ? null : localStorage;
      storage?.getItem('__tessera_probe__');
    } catch {
      storage = null;
    }
    this.storage = storage;
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
  }

  get(key: string): JsonValue | undefined {
    if (!this.storage) return this.memory.get(key);
    try {
      const raw = this.storage.getItem(this.prefix + key);
      if (raw === null) return this.memory.get(key);
      const value: unknown = JSON.parse(raw);
      return isJsonValue(value) ? value : undefined;
    } catch {
      return this.memory.get(key);
    }
  }

  set(key: string, value: JsonValue | undefined): void {
    if (value !== undefined && !isJsonValue(value))
      throw new TypeError(`Setting "${key}" must be a JSON value`);
    this.memory.set(key, value);
    try {
      if (value === undefined) this.storage?.removeItem(this.prefix + key);
      else this.storage?.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage disabled: the value lives in memory for this session.
    }
    this.emit(key);
  }

  keys(prefix = ''): string[] {
    const keys = new Set(this.memory.keys(prefix));
    if (this.storage) {
      for (let i = 0; i < this.storage.length; i += 1) {
        const full = this.storage.key(i);
        if (full?.startsWith(this.prefix + prefix)) keys.add(full.slice(this.prefix.length));
      }
    }
    return [...keys].sort();
  }

  subscribe(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
    this.listeners.clear();
  }

  private emit(key: string): void {
    for (const listener of [...this.listeners]) listener(key);
  }
}

/** {@link SettingsStore} backed by the workspace doc's `settings` map (shared, synced). */
export class WorkspaceSettingsStore implements SettingsStore {
  constructor(private readonly ws: Y.Doc) {}

  get(key: string): JsonValue | undefined {
    return getWorkspaceSetting(this.ws, key);
  }

  set(key: string, value: JsonValue | undefined): void {
    setWorkspaceSetting(this.ws, key, value);
  }

  keys(prefix = ''): string[] {
    return listWorkspaceSettingKeys(this.ws, prefix);
  }

  subscribe(listener: (key: string) => void): () => void {
    return observeWorkspaceSettings(this.ws, (keys) => {
      for (const key of keys) listener(key);
    });
  }
}
