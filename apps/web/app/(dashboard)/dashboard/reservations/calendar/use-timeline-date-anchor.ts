"use client";

import { useEffect, useMemo, useRef } from "react";

import { useSearchParams } from "next/navigation";

import { createDashboardReturnTo } from "@/lib/dashboard/util.reservation-navigation";

import { toCalendarDateParam } from "./calendar-query";

interface UseTimelineDateAnchorOptions {
  /** Which timeline the `returnTo` round-trip should reopen. */
  view: "calendar" | "planning";
  dateParam: Date | null;
  /** Day currently at the viewport's reference point. */
  visibleDate: Date;
  /** Jumps the viewport to a day; `"auto"` must not smooth-scroll. */
  goToDate: (date: Date, behavior: ScrollBehavior) => void;
}

/**
 * Date anchoring shared by both timeline views: re-centre on the URL `date`
 * after back-navigation, persist the visible day before leaving, and build the
 * `returnTo` the reservation detail page navigates back to.
 */
export function useTimelineDateAnchor({
  view,
  dateParam,
  visibleDate,
  goToDate,
}: UseTimelineDateAnchorOptions) {
  const searchParams = useSearchParams();

  /** Timestamp of the last date this view itself wrote to the URL. */
  const persistedDateRef = useRef<number | null>(null);
  const dateParamTime = dateParam?.getTime() ?? null;

  // Browser/Next scroll restoration can run after layout effects on a cached
  // navigation. Re-apply any URL anchor after paint so it wins over an older
  // horizontal scroll position restored by the browser.
  useEffect(() => {
    if (dateParamTime === null) return;
    // Our own viewport writes echo back through the URL. Recentering on them
    // would nudge the scroll position the user is already looking at.
    if (persistedDateRef.current === dateParamTime) return;

    let finalFrame = 0;
    const initialFrame = requestAnimationFrame(() => {
      finalFrame = requestAnimationFrame(() => {
        goToDate(new Date(dateParamTime), "auto");
      });
    });

    return () => {
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(finalFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateParamTime]);

  /**
   * Records the day at the centre of the viewport before navigating away, so
   * coming back lands on it. Normalized to midnight to match how the param
   * parses back in.
   *
   * Written synchronously through `history.replaceState`, NOT through nuqs:
   * the nuqs flush is a throttled macrotask, and when it lands between the
   * Link's push and the navigation commit, its replaceState reconciles the
   * router back onto the current URL and the navigation is swallowed. The
   * patched history sees this external write and just drops any queued nuqs
   * update, so the two writers cannot fight.
   */
  const persistVisibleDate = () => {
    const date = new Date(visibleDate);
    date.setHours(0, 0, 0, 0);
    persistedDateRef.current = date.getTime();

    const params = new URLSearchParams(window.location.search);
    params.set("date", toCalendarDateParam(date));
    const search = params.toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  };

  // Rebuilt every render rather than read back from the URL: nuqs flushes URL
  // updates on a throttled macrotask, so a middle-click or a new-tab open can
  // beat the flush. This always carries the date currently on screen.
  const returnTo = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.set("date", toCalendarDateParam(visibleDate));
    return createDashboardReturnTo("/dashboard/reservations", params);
  }, [searchParams, view, visibleDate]);

  return { persistVisibleDate, returnTo };
}
