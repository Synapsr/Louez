"use client";

import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

const HOVER_OPEN_DELAY_MS = 220;
const HOVER_CLOSE_DELAY_MS = 320;

/**
 * Hover that waits for intent, for disclosures that open on hover (a nav
 * section unfolding its pages).
 *
 * Opening on contact ambushes the pointer: sweeping down a list unfolds every
 * section on the way and pushes the row you aimed at out from under the
 * cursor. Here the pointer has to rest for a moment before `hovered` turns
 * true, so a quick pass opens nothing; once open it stays while the pointer
 * is inside and lingers a beat after it leaves, so a slightly off diagonal
 * toward a sub-entry does not snap it shut. Mouse only: touch and pen have no
 * hover worth reading.
 *
 * Spread the handlers on the element that wraps both the trigger and what it
 * reveals. While `enabled` is false the hover never reads as true.
 */
export const useHoverIntent = (enabled: boolean) => {
  const [rawHovered, setRawHovered] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerEnter = (event: PointerEvent) => {
    if (!enabled || event.pointerType !== "mouse") return;
    clear();
    timer.current = window.setTimeout(() => setRawHovered(true), HOVER_OPEN_DELAY_MS);
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clear();
    timer.current = window.setTimeout(() => setRawHovered(false), HOVER_CLOSE_DELAY_MS);
  };

  return { hovered: enabled && rawHovered, onPointerEnter, onPointerLeave };
};
