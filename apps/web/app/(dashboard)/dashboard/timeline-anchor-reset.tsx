"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { clearTimelineAnchor } from "./reservations/calendar/util.timeline-anchor-storage";

export const TimelineAnchorReset = () => {
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    const previous = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    const isReservationsRoute = pathname?.startsWith("/dashboard/reservations");
    const wasReservationsRoute = previous?.startsWith("/dashboard/reservations");

    if (!isReservationsRoute) {
      clearTimelineAnchor();
    } else if (!wasReservationsRoute) {
      clearTimelineAnchor();
    }
  }, [pathname]);

  return null;
};
