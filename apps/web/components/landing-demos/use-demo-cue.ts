"use client";
import { useEffect, useRef } from "react";
import { DEMO_CUE_EVENT } from "./demo-gestures";

/** Runs `handler` when the script reaches the `emit` cue of that name. */
export const useDemoCue = (name: string, handler: () => void) => {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listen = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === name) latest.current();
    };
    document.addEventListener(DEMO_CUE_EVENT, listen);
    return () => document.removeEventListener(DEMO_CUE_EVENT, listen);
  }, [name]);
};
