import type { JsonValue } from '@tessera/core';
import type { InstalledPlugin, InstalledPluginCode, PluginStore } from './types';

/** An in-memory {@link PluginStore} (tests, and browsers without IndexedDB). */
export class MemoryPluginStore implements PluginStore {
  private readonly plugins = new Map<string, InstalledPlugin>();
  private readonly code = new Map<string, InstalledPluginCode>();
  private readonly storage = new Map<string, Map<string, JsonValue>>();

  async list(): Promise<InstalledPlugin[]> {
    return [...this.plugins.values()].map((plugin) => structuredClone(plugin));
  }

  async get(id: string): Promise<InstalledPlugin | undefined> {
    const plugin = this.plugins.get(id);
    return plugin ? structuredClone(plugin) : undefined;
  }

  async put(plugin: InstalledPlugin, code?: InstalledPluginCode): Promise<void> {
    this.plugins.set(plugin.id, structuredClone(plugin));
    if (code) this.code.set(plugin.id, { ...code });
  }

  async getCode(id: string): Promise<InstalledPluginCode | undefined> {
    const code = this.code.get(id);
    return code ? { ...code } : undefined;
  }

  async delete(id: string): Promise<void> {
    this.plugins.delete(id);
    this.code.delete(id);
    this.storage.delete(id);
  }

  async storageGet(id: string, key: string): Promise<JsonValue | undefined> {
    const value = this.storage.get(id)?.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async storageSet(id: string, key: string, value: JsonValue): Promise<void> {
    let map = this.storage.get(id);
    if (!map) {
      map = new Map();
      this.storage.set(id, map);
    }
    map.set(key, structuredClone(value));
  }

  async storageDelete(id: string, key: string): Promise<void> {
    this.storage.get(id)?.delete(key);
  }

  async storageEntries(id: string): Promise<Array<{ key: string; size: number }>> {
    return [...(this.storage.get(id) ?? new Map<string, JsonValue>()).entries()]
      .map(([key, value]) => ({ key, size: JSON.stringify(value).length }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async storageClear(id: string): Promise<void> {
    this.storage.delete(id);
  }

  close(): void {
    // Nothing to release.
  }
}
