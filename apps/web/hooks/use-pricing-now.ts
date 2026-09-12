"use client";

import { useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    interval = setInterval(notify, 1000);
    window.addEventListener("focus", notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(interval);
      window.removeEventListener("focus", notify);
    }
  };
};
const getSnapshot = () => Math.floor(Date.now() / 60000) * 60000;

/** Refresh scheduled prices at minute boundaries and when the tab regains focus. */
export const usePricingNow = (): Date => {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => new Date(minute), [minute]);
};
