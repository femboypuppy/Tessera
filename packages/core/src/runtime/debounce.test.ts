import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchDebouncer } from './debounce';

describe('createBatchDebouncer', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('runs once for every key of a burst, after the last call', () => {
    const batches: string[][] = [];
    const debouncer = createBatchDebouncer((keys) => batches.push(keys), {
      delayMs: 100,
      maxWaitMs: 1000,
    });
    debouncer.call('a');
    vi.advanceTimersByTime(60);
    debouncer.call('b');
    debouncer.call('a');
    expect(debouncer.pending()).toBe(2);
    vi.advanceTimersByTime(99);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(batches).toEqual([['a', 'b']]);
    expect(debouncer.pending()).toBe(0);
  });

  it('never waits longer than maxWaitMs while calls keep coming', () => {
    const batches: string[][] = [];
    const debouncer = createBatchDebouncer((keys) => batches.push(keys), {
      delayMs: 100,
      maxWaitMs: 300,
    });
    for (let i = 0; i < 10; i += 1) {
      debouncer.call(`page-${i}`);
      vi.advanceTimersByTime(50);
    }
    // 500 ms of steady calls: the first batch ran at 300 ms, the rest waits for the next one.
    expect(batches[0]).toEqual(['page-0', 'page-1', 'page-2', 'page-3', 'page-4', 'page-5']);
    vi.advanceTimersByTime(100);
    expect(batches[1]).toEqual(['page-6', 'page-7', 'page-8', 'page-9']);
  });

  it('flushes and cancels', () => {
    const batches: string[][] = [];
    const debouncer = createBatchDebouncer((keys) => batches.push(keys), {
      delayMs: 100,
      maxWaitMs: 1000,
    });
    debouncer.call('a');
    debouncer.flush();
    expect(batches).toEqual([['a']]);
    debouncer.call('b');
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(batches).toEqual([['a']]);
    debouncer.flush();
    expect(batches).toEqual([['a']]);
  });
});
