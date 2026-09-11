"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The rendered height of an element, kept current through a ResizeObserver.
 * For containers that animate to their content's size: Framer cannot tween
 * `auto`, so the parent animates to this number while the child keeps its
 * natural height.
 */
export const useMeasuredHeight = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
};
