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

/** Collects keys and runs one call for all of them (see {@link createBatchDebouncer}). */
export interface BatchDebouncer {
  call(key: string): void;
  /** Runs the pending batch now. */
  flush(): void;
  /** Drops the pending batch. */
  cancel(): void;
  pending(): number;
}

/**
 * Collects keys and runs `fn(keys)` once for all of them: `delayMs` after the last call, and at
 * most `maxWaitMs` after the first key of the batch. For work that is cheaper in one go than key
 * by key, such as one transaction for many pages.
 */
export function createBatchDebouncer(
  fn: (keys: string[]) => void,
  options: { delayMs: number; maxWaitMs: number },
): BatchDebouncer {
  const keys = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (keys.size === 0) return;
    const batch = [...keys];
    keys.clear();
    fn(batch);
  };
  return {
    call(key) {
      const now = Date.now();
      if (keys.size === 0) firstAt = now;
      keys.add(key);
      if (options.delayMs <= 0) return run();
      if (timer) clearTimeout(timer);
      const wait = Math.max(0, Math.min(options.delayMs, firstAt + options.maxWaitMs - now));
      timer = setTimeout(run, wait);
    },
    flush: run,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      keys.clear();
    },
    pending: () => keys.size,
  };
}
