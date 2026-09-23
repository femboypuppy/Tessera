import { useCallback, useRef, useSyncExternalStore } from 'react';

/** A tiny external store for editor UI state (menus, popovers). Never holds document content. */
export interface Store<T> {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

/** Creates a {@link Store}. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Reads a store (or a slice of it) and re-renders when it changes. The selector's result is
 * compared with `Object.is`, so return primitives or stable objects.
 */
export function useStore<T, S = T>(store: Store<T>, selector?: (value: T) => S): S {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const get = useCallback(() => {
    const value = store.get();
    return selectorRef.current ? selectorRef.current(value) : (value as unknown as S);
  }, [store]);
  return useSyncExternalStore(store.subscribe, get, get);
}
