"use client";

import { useEffect } from "react";

export const useParentScroll = (enabled: boolean, parentOrigin: string | null) => {
  useEffect(() => {
    if (!enabled || !parentOrigin || window.parent === window) return;

    const forward = (deltaY: number, input: "wheel" | "touch") => {
      window.parent.postMessage({ type: "louez:demo:scroll", deltaY, input }, parentOrigin);
    };
    const wheel = (event: WheelEvent) => {
      // Keep pinch-to-zoom and intentional horizontal scrolling in the browser.
      if (
        event.ctrlKey ||
        event.shiftKey ||
        !event.cancelable ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      forward(event.deltaY * unit, "wheel");
    };
    let previous: { x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      previous = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (!touch || !previous) {
        previous = null;
        return;
      }
      const deltaY = previous.y - touch.clientY;
      const deltaX = previous.x - touch.clientX;
      previous = { x: touch.clientX, y: touch.clientY };
      if (!event.cancelable || Math.abs(deltaY) <= Math.abs(deltaX)) return;
      event.preventDefault();
      event.stopPropagation();
      forward(deltaY, "touch");
    };
    const end = () => {
      previous = null;
    };

    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("touchstart", start, { capture: true, passive: true });
    window.addEventListener("touchmove", move, { capture: true, passive: false });
    window.addEventListener("touchend", end, { capture: true, passive: true });
    window.addEventListener("touchcancel", end, { capture: true, passive: true });
    return () => {
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("touchstart", start, true);
      window.removeEventListener("touchmove", move, true);
      window.removeEventListener("touchend", end, true);
      window.removeEventListener("touchcancel", end, true);
    };
  }, [enabled, parentOrigin]);
};
