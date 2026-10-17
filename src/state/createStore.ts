import { useSyncExternalStore } from 'react';

/** Tiny external store (no dependency) used with React's useSyncExternalStore. */
export interface StoreApi<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): StoreApi<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Subscribe to a slice. Selectors must return stable references (state fields or primitives). */
export function useStore<T extends object, U>(api: StoreApi<T>, selector: (s: T) => U): U {
  return useSyncExternalStore(api.subscribe, () => selector(api.get()));
}
