/**
 * localStorage access that degrades to a no-op when storage is unavailable
 * (private-mode failures, SSR, or test environments that don't install it).
 * The dev token gate uses it to persist a pasted token; losing it just means
 * re-entering the token.
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(key: string): string | null {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      store()?.setItem(key, value);
    } catch {
      // Ignore quota/security errors — persistence is best-effort.
    }
  },
  remove(key: string): void {
    try {
      store()?.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};
