"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface UseResizablePanelOptions {
  defaultWidth: number;
  min: number;
  max: number;
  /** localStorage key; the width is a per-browser convenience, never shared. */
  storageKey: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readStoredWidth = (key: string): number | null => {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const storeWidth = (key: string, width: number) => {
  try {
    window.localStorage.setItem(key, String(width));
  } catch {
    // Private mode or blocked storage: the width just does not survive a reload.
  }
};

/**
 * The width of a side panel the user drags, clamped and remembered. The
 * drag follows the pointer from where it grabbed the handle; the keyboard
 * moves it in steps. The stored width is read after mount so the server
 * and the first client render agree on the default.
 */
export const useResizablePanel = ({
  defaultWidth,
  min,
  max,
  storageKey,
}: UseResizablePanelOptions) => {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const stored = readStoredWidth(storageKey);
    if (stored !== null) setWidth(clamp(stored, min, max));
  }, [storageKey, min, max]);

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(Math.round(next), min, max);
      setWidth(clamped);
      storeWidth(storageKey, clamped);
    },
    [min, max, storageKey],
  );

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: width };
      setDragging(true);
    },
    [width],
  );

  const drag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = dragRef.current;
      if (!start) return;
      commit(start.startWidth + (event.clientX - start.startX));
    },
    [commit],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const resizeBy = useCallback((delta: number) => commit(width + delta), [commit, width]);
  const resizeTo = useCallback((next: number) => commit(next), [commit]);
  const reset = useCallback(() => commit(defaultWidth), [commit, defaultWidth]);

  return { width, min, max, dragging, startDrag, drag, endDrag, resizeBy, resizeTo, reset };
};

export type ResizablePanel = ReturnType<typeof useResizablePanel>;
