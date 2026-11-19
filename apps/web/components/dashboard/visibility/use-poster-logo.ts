"use client";

import { useEffect, useState } from "react";

/**
 * The store's logo for the poster's canvas: loaded with CORS, and dropped when
 * the canvas could not export it (a host that answers without CORS headers
 * would block the PNG). `undefined` while loading, null without a usable one:
 * the poster then prints the store's name.
 */
export const usePosterLogo = (logoUrl: string | null | undefined) => {
  const [logo, setLogo] = useState<HTMLImageElement | null | undefined>(logoUrl ? undefined : null);

  useEffect(() => {
    if (!logoUrl) {
      setLogo(null);
      return;
    }
    let cancelled = false;
    setLogo(undefined);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      try {
        const probe = document.createElement("canvas");
        probe.width = 1;
        probe.height = 1;
        probe.getContext("2d")?.drawImage(image, 0, 0, 1, 1);
        probe.toDataURL();
        setLogo(image);
      } catch {
        setLogo(null);
      }
    };
    image.onerror = () => {
      if (!cancelled) setLogo(null);
    };
    image.src = logoUrl;
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  return logo;
};
