import { afterEach, beforeEach, vi } from "vitest";

type Store = Map<string, string>;

export function installMemorySessionStorage(): Store {
  const store: Store = new Map();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  vi.stubGlobal("sessionStorage", memoryStorage);
  return store;
}

export function useFinancialIdempotencyTestHarness() {
  beforeEach(() => {
    installMemorySessionStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}
