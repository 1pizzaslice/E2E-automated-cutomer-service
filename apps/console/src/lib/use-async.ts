import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "./errors.js";

export interface AsyncState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** Re-run the async function (e.g. after a mutation or on a poll tick). */
  readonly reload: () => void;
}

/**
 * Run an async function and track its data/error/loading, re-running when
 * `deps` change or `reload()` is called. The last in-flight call wins — stale
 * responses are dropped, so a fast reload never clobbers a newer result.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fn()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(describeError(caught));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // fn is intentionally excluded — callers pass a fresh closure each render;
    // deps + nonce control re-execution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}

/** Call `callback` every `delayMs` while mounted (a queue-freshness poll). */
export function useInterval(callback: () => void, delayMs: number): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
