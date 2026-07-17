"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface MeasuredSize {
  width: number;
  height: number;
}

const EMPTY_SIZE: MeasuredSize = {
  width: 0,
  height: 0,
};

interface UseMeasuredSizeOptions {
  observeHeight: boolean;
}

const readElementSize = (element: HTMLElement): MeasuredSize => {
  const { width, height } = element.getBoundingClientRect();

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
};

export const useMeasuredSize = ({ observeHeight }: UseMeasuredSizeOptions) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState(EMPTY_SIZE);
  const committedSizeRef = useRef(EMPTY_SIZE);

  const commitMeasuredSize = useCallback(
    (measuredSize: MeasuredSize, includeHeight: boolean) => {
      const currentSize = committedSizeRef.current;
      const nextSize = {
        width: measuredSize.width,
        height:
          includeHeight || currentSize.height === 0 ? measuredSize.height : currentSize.height,
      };

      if (currentSize.width === nextSize.width && currentSize.height === nextSize.height) {
        return;
      }

      committedSizeRef.current = nextSize;
      setSize(nextSize);
    },
    [],
  );

  const measureNow = useCallback(() => {
    if (!element) return;

    commitMeasuredSize(readElementSize(element), true);
  }, [commitMeasuredSize, element]);

  useLayoutEffect(() => {
    if (!element) return;

    const updateMeasuredSize = () => {
      commitMeasuredSize(readElementSize(element), observeHeight);
    };

    updateMeasuredSize();

    const observer = new ResizeObserver(updateMeasuredSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, [commitMeasuredSize, element, observeHeight]);

  return {
    ref: setElement,
    measureNow,
    size,
  };
};
