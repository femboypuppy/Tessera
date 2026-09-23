import { PLUGIN_LIMITS } from '../constants';

/** One line of a plugin's console. */
export interface ConsoleEntry {
  id: number;
  time: number;
  level: 'debug' | 'log' | 'info' | 'warn' | 'error';
  /** `plugin`: the plugin's own console output. `host`: what Tessera noticed (crashes, refusals). */
  source: 'plugin' | 'host';
  message: string;
  /** Where it came from: `worker`, `panel`, `block`. */
  surface?: string;
}

/**
 * Per-plugin consoles: plugin output, errors, crashes, timeouts and refused calls. Kept in memory
 * for the whole app run (a plugin that crashed still shows why after it stopped).
 */
export class PluginConsoleStore {
  private readonly logs = new Map<string, ConsoleEntry[]>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private version = 0;

  add(pluginId: string, entry: Omit<ConsoleEntry, 'id' | 'time'> & { time?: number }): void {
    const list = this.logs.get(pluginId) ?? [];
    const message =
      entry.message.length > PLUGIN_LIMITS.consoleChars
        ? `${entry.message.slice(0, PLUGIN_LIMITS.consoleChars)}…`
        : entry.message;
    const next: ConsoleEntry = {
      ...entry,
      message,
      id: this.nextId,
      time: entry.time ?? Date.now(),
    };
    this.nextId += 1;
    const updated = [...list, next];
    this.logs.set(
      pluginId,
      updated.length > PLUGIN_LIMITS.consoleEntries
        ? updated.slice(updated.length - PLUGIN_LIMITS.consoleEntries)
        : updated,
    );
    this.changed();
  }

  entries(pluginId: string): readonly ConsoleEntry[] {
    return this.logs.get(pluginId) ?? EMPTY;
  }

  /** Errors and warnings since the console was last cleared. */
  problems(pluginId: string): number {
    return this.entries(pluginId).filter(
      (entry) => entry.level === 'error' || entry.level === 'warn',
    ).length;
  }

  clear(pluginId: string): void {
    if (!this.logs.has(pluginId)) return;
    this.logs.delete(pluginId);
    this.changed();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

const EMPTY: readonly ConsoleEntry[] = [];
