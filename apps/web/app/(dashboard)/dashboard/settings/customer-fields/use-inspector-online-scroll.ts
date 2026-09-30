"use client";

import { useEffect, useRef } from "react";

import type { InspectorFocus } from "./customer-fields-builder-context";

/** Room left above "Réservation en ligne" once scrolled to: its title and a little air. */
const ONLINE_SCROLL_OFFSET = 56;

/**
 * A field picked from the client view opens its inspector on "Réservation en
 * ligne": the inspector's body scrolls there (the page does not move). Each
 * new click (`request`) scrolls again.
 */
export const useInspectorOnlineScroll = (focus: InspectorFocus, request: number) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const onlineRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    const anchor = onlineRef.current;
    if (focus !== "online" || !body || !anchor) return;
    body.scrollTo({
      top:
        body.scrollTop +
        anchor.getBoundingClientRect().top -
        body.getBoundingClientRect().top -
        ONLINE_SCROLL_OFFSET,
      behavior: "smooth",
    });
  }, [focus, request]);

  return { bodyRef, onlineRef };
};
