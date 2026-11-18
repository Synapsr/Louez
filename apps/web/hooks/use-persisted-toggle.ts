"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be blocked (private mode, strict settings): the default stands.
    return null;
  }
};

/**
 * A yes/no a person chose on this browser (a section folded or unfolded),
 * kept in localStorage so it survives the next visit. The server and the
 * first render use `fallback`; without storage it stays a plain state of
 * the page.
 */
export const usePersistedToggle = (key: string, fallback: boolean) => {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    window.addEventListener("storage", onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = stored === null ? fallback : stored === "1";

  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Not kept: the next visit shows the default again.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [value, setValue] as const;
};
