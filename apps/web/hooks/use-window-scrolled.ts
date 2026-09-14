"use client";

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
};

const getServerSnapshot = () => false;

/**
 * True once the window has scrolled past `threshold` pixels. Server and
 * first client render agree on `false`, so a transparent header hydrates
 * without a flash.
 */
export const useWindowScrolled = (threshold = 8): boolean =>
  useSyncExternalStore(subscribe, () => window.scrollY > threshold, getServerSnapshot);
