"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The rendered size of an element, kept current through a ResizeObserver.
 * Zero until the first layout, so a consumer can hold off on anything that
 * depends on it.
 */
export const useElementSize = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
};
