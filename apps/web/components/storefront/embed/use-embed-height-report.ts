"use client";

import { useEffect, useRef } from "react";

import { postEmbedHeight } from "@/lib/embed/util.embed-messaging";

/**
 * Tells the host page how tall the widget is, so the iframe follows. The
 * observed box must be the whole document: inside an iframe
 * `documentElement` is at least as tall as the frame, so it could only
 * ever report growth.
 */
export const useEmbedHeightReport = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      // A detached or still-collapsed widget would tell the host to hide it.
      if (height > 0) postEmbedHeight(height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return ref;
};
