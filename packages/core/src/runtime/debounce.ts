/**
 * Debounces calls per key: `fn(key, value)` runs `delayMs` after the last call for that key, and at
 * most `maxWaitMs` after the first call of a burst. Values of a burst are merged with `merge`.
 */
export interface KeyedDebouncer<V> {
  call(key: string, value: V): void;
  /** Runs every pending call now. */
  flush(): void;
  /** Drops every pending call. */
  cancel(): void;
  pending(): number;
}

export function createKeyedDebouncer<V>(
  fn: (key: string, value: V) => void,
  options: { delayMs: number; maxWaitMs: number; merge: (previous: V, next: V) => V },
): KeyedDebouncer<V> {
  const entries = new Map<
    string,
    { value: V; timer: ReturnType<typeof setTimeout> | null; firstAt: number }
  >();
  const run = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entries.delete(key);
    fn(key, entry.value);
  };
  return {
    call(key, value) {
      const existing = entries.get(key);
      const now = Date.now();
      if (options.delayMs <= 0) {
        fn(key, existing ? options.merge(existing.value, value) : value);
        if (existing?.timer) clearTimeout(existing.timer);
        entries.delete(key);
        return;
      }
      const entry = existing ?? { value, timer: null, firstAt: now };
      if (existing) {
        entry.value = options.merge(existing.value, value);
        if (existing.timer) clearTimeout(existing.timer);
      }
      const wait = Math.max(0, Math.min(options.delayMs, entry.firstAt + options.maxWaitMs - now));
      entry.timer = setTimeout(() => run(key), wait);
      entries.set(key, entry);
    },
    flush() {
      for (const key of [...entries.keys()]) run(key);
    },
    cancel() {
      for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer);
      entries.clear();
    },
    pending: () => entries.size,
  };
}
