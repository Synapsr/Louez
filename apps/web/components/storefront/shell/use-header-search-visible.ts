"use client";

import { useEffect, useState } from "react";

import { usePathname } from "next/navigation";

interface HeaderSearchVisibleOptions {
  /**
   * Keeps the search out while the page sits at the top, instead of only
   * bringing it back on the way up. Every page wants it but the home,
   * whose hero already asks for the dates.
   */
  showAtTop?: boolean;
}

/**
 * Whether the phone header shows its search: out at the top when the page
 * asks for it, gone on the way down, back on the way up.
 */
export const useHeaderSearchVisible = ({
  showAtTop = false,
}: HeaderSearchVisibleOptions = {}): boolean => {
  const pathname = usePathname();
  const [visibility, setVisibility] = useState({ pathname, visible: showAtTop });

  useEffect(() => {
    let previousY = Math.max(0, window.scrollY);
    let direction = 0;
    let distance = 0;
    let visible = showAtTop && previousY <= 8;
    let ignoreScrollUntil = 0;
    setVisibility({ pathname, visible });

    const onScroll = () => {
      const currentY = Math.max(
        0,
        Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight),
      );
      const delta = currentY - previousY;
      previousY = currentY;
      // Height animation can move scrollY through browser scroll anchoring.
      // Keep tracking the position, but ignore direction until it settles.
      if (performance.now() < ignoreScrollUntil) return;

      if (currentY <= 8) {
        direction = 0;
        distance = 0;
        if (visible !== showAtTop) {
          visible = showAtTop;
          ignoreScrollUntil = performance.now() + 250;
          setVisibility({ pathname, visible });
        }
        return;
      }
      if (delta === 0) return;

      const nextDirection = Math.sign(delta);
      distance = nextDirection === direction ? distance + Math.abs(delta) : Math.abs(delta);
      direction = nextDirection;
      if (distance < 8) return;

      const nextVisible = direction < 0;
      if (nextVisible === visible) return;

      visible = nextVisible;
      direction = 0;
      distance = 0;
      ignoreScrollUntil = performance.now() + 250;
      setVisibility({ pathname, visible });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname, showAtTop]);

  return visibility.pathname === pathname && visibility.visible;
};
