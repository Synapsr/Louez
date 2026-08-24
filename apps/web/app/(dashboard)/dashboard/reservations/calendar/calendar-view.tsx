"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  UIEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription, Button } from "@louez/ui";
import { ReservationsGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import {
  getTimelineStatus,
  TimelineReservationBar,
} from "@/components/dashboard/reservations-timeline/timeline-reservation-bar";
import {
  type TimelineReservation,
  type TimelineReservationItem,
  addDays,
  compareByDisplayOrder,
  computeMonthSegments,
  diffInDays,
  findNearestTimelineItem,
  formatDeliveryAddress,
  getTimelineNavigationBufferDirection,
  isWeekend,
  stackReservations,
  timelineRangesOverlap,
} from "@/components/dashboard/reservations-timeline/timeline-utils";
import { reservationCalendarQueries } from "@/lib/queries/reservation-calendar.queries";

import {
  type CalendarRange,
  matchesTodayOperation,
  parseCalendarDateParam,
  persistCalendarDateInHistory,
} from "./calendar-query";
import { TimelineToolbar, useTimelineFilters } from "./timeline-toolbar";
import type { Product, Reservation } from "./types";

// =============================================================================
// Constants — mirror the planning timeline so both views feel identical
// =============================================================================

const DAY_WIDTHS: Record<CalendarRange, number> = {
  week: 96,
  twoWeeks: 60,
  month: 38,
};

/** Days scrolled per arrow click */
const NAV_DAYS: Record<CalendarRange, number> = {
  week: 7,
  twoWeeks: 14,
  month: 30,
};

const MONTH_ROW_HEIGHT = 26;
const DAY_ROW_HEIGHT = 42;
const HEADER_HEIGHT = MONTH_ROW_HEIGHT + DAY_ROW_HEIGHT;
const ROW_HEIGHT = 34;
const BAR_HEIGHT = 30;
/** Minimum stacked lanes so an empty period still shows a usable grid */
const MIN_LANES = 5;

/** Prefilled times for drag-created reservations */
const DRAG_CREATE_START_HOUR = 9;
const DRAG_CREATE_END_HOUR = 18;
/** Prevent a click or tiny pointer jitter from starting a reservation */
const DRAG_START_THRESHOLD_PX = 4;

/** Days added per infinite-scroll extension (multiple of 7 keeps Monday alignment) */
const EXTEND_CHUNK_DAYS = 28;
/** Distance from an edge (px) that triggers an extension */
const EXTEND_THRESHOLD_PX = 320;
/** Hard cap on the loaded window to keep the DOM bounded */
const MAX_DAYS_COUNT = 560;

// =============================================================================
// Types
// =============================================================================

interface DragSelection {
  startIndex: number;
  endIndex: number;
}

interface DragAnchor {
  dayIndex: number;
  clientX: number;
  clientY: number;
}

interface VerticalRange {
  start: number;
  end: number;
}

interface ReservationsCalendarViewProps {
  products: Product[];
  currency: string;
  storeHasReservations: boolean;
  storeId: string;
}

// =============================================================================
// Component
// =============================================================================

export function ReservationsCalendarView({
  products,
  currency,
  storeHasReservations,
  storeId,
}: ReservationsCalendarViewProps) {
  const tTimeline = useTranslations("dashboard.calendar.timeline");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");

  // ---------------------------------------------------------------------------
  // URL-persisted view state (zoom + status/product filters) — shareable links
  // ---------------------------------------------------------------------------

  const filters = useTimelineFilters(products, storeId);
  const { hiddenStatuses, selectedProductIds, todayOperation } = filters;

  const zoom = filters.range;
  const dayWidth = DAY_WIDTHS[zoom];

  // ---------------------------------------------------------------------------
  // Window state (infinite horizontal scroll)
  // ---------------------------------------------------------------------------

  // Anchor on the `date` param when present (legacy links)
  const anchorDateRef = useRef(
    parseCalendarDateParam(searchParams.get("date") ?? undefined) ?? new Date(),
  );
  const initialWindowRef = useRef(reservationCalendarQueries.initialWindow(anchorDateRef.current));

  const [windowStart, setWindowStart] = useState(initialWindowRef.current.start);
  const [daysCount, setDaysCount] = useState(initialWindowRef.current.daysCount);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingPrependRef = useRef(0);
  const appendLockRef = useRef(false);
  const zoomAnchorRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);

  const handleZoomChange = (range: CalendarRange) => {
    const element = scrollerRef.current;
    if (element) {
      zoomAnchorRef.current = element.scrollLeft / dayWidth;
    }
    filters.setRange(range);
  };

  // ---------------------------------------------------------------------------
  // Data — React Query, one cached query per fixed 28-day chunk. Scrolling
  // mounts the next chunks; cached chunks render instantly, so navigating
  // through time never shows a loading state.
  // ---------------------------------------------------------------------------

  const chunkQueries = useMemo(
    () => reservationCalendarQueries.forWindow(storeId, windowStart, daysCount),
    [storeId, windowStart, daysCount],
  );

  const { reservations, isFetching, hasError, retry } = useQueries({
    queries: chunkQueries,
    combine: (results) => {
      const byId = new Map<string, Reservation>();
      for (const result of results) {
        for (const reservation of result.data ?? []) {
          byId.set(reservation.id, reservation);
        }
      }
      return {
        reservations: Array.from(byId.values()),
        isFetching: results.some((result) => result.isFetching),
        hasError: results.some((result) => result.isError),
        retry: () => Promise.all(results.map((result) => result.refetch())),
      };
    },
  });

  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);

  useEffect(() => {
    if (hasCompletedInitialLoad || isFetching) return;
    setHasCompletedInitialLoad(true);
  }, [hasCompletedInitialLoad, isFetching]);

  const showInitialLoadingOverlay = !hasCompletedInitialLoad && isFetching && !hasError;

  // ---------------------------------------------------------------------------
  // Derived layout data
  // ---------------------------------------------------------------------------

  const timelineEntries = useMemo((): TimelineReservation[] => {
    return reservations
      .filter((reservation) => {
        if (!matchesTodayOperation(reservation, todayOperation)) {
          return false;
        }
        if (hiddenStatuses.has(getTimelineStatus(reservation.status))) {
          return false;
        }
        if (selectedProductIds.size === 0) return true;
        return reservation.items.some(
          (item) => item.product !== null && selectedProductIds.has(item.product.id),
        );
      })
      .map((reservation) => {
        // Aggregate line items per product for the tooltip, then order them
        // like the catalog so the same reservation always reads the same way.
        const linesByProduct = new Map<
          string,
          TimelineReservationItem & { displayOrder: number }
        >();
        for (const item of reservation.items) {
          const name = item.productSnapshot?.name || item.product?.name;
          if (!name) continue;

          // Custom items and deleted products have no live product to key on.
          const key = item.product?.id ?? `snapshot:${name}`;
          const existing = linesByProduct.get(key);
          if (existing) {
            existing.quantity += Math.max(1, item.quantity);
            continue;
          }

          linesByProduct.set(key, {
            productId: item.product?.id ?? null,
            name,
            quantity: Math.max(1, item.quantity),
            imageUrl: item.product?.images?.[0] ?? item.productSnapshot?.images?.[0] ?? null,
            displayOrder: item.product?.displayOrder ?? 0,
          });
        }

        return {
          id: reservation.id,
          number: reservation.number,
          status: reservation.status,
          startDate: new Date(reservation.startDate),
          endDate: new Date(reservation.endDate),
          customerId: reservation.customer?.id ?? null,
          customerName: reservation.customer
            ? [reservation.customer.firstName, reservation.customer.lastName]
                .filter(Boolean)
                .join(" ") || "—"
            : "—",
          subtotalAmount: reservation.subtotalAmount,
          depositAmount: reservation.depositAmount,
          totalAmount: reservation.totalAmount,
          quantity: reservation.items.reduce((sum, item) => sum + item.quantity, 0),
          assignedUnitIds: [],
          items: Array.from(linesByProduct.values())
            .sort(compareByDisplayOrder)
            .map(({ displayOrder: _displayOrder, ...item }) => item),
          outboundDeliveryAddress:
            reservation.outboundMethod === "address"
              ? formatDeliveryAddress({
                  address: reservation.deliveryAddress,
                  city: reservation.deliveryCity,
                  postalCode: reservation.deliveryPostalCode,
                  country: reservation.deliveryCountry,
                })
              : null,
          returnDeliveryAddress:
            reservation.returnMethod === "address"
              ? formatDeliveryAddress({
                  address: reservation.returnAddress,
                  city: reservation.returnCity,
                  postalCode: reservation.returnPostalCode,
                  country: reservation.returnCountry,
                })
              : null,
        };
      });
  }, [reservations, hiddenStatuses, selectedProductIds, todayOperation]);

  const { placed, laneCount } = useMemo(
    () => stackReservations({ reservations: timelineEntries, windowStart }),
    [timelineEntries, windowStart],
  );
  const lanes = Math.max(laneCount, MIN_LANES);

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, index) => addDays(windowStart, index)),
    [windowStart, daysCount],
  );

  const monthSegments = useMemo(
    () => computeMonthSegments(windowStart, daysCount),
    [windowStart, daysCount],
  );

  const todayIndex = diffInDays(windowStart, new Date());

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const dayNameFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short" }),
    [locale],
  );

  const formatMonthLabel = (date: Date) => {
    const label = monthFormatter.format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const [visibleMonthLabel, setVisibleMonthLabel] = useState(() =>
    formatMonthLabel(anchorDateRef.current),
  );
  const [visibleDate, setVisibleDate] = useState(anchorDateRef.current);
  const [visibleDayRange, setVisibleDayRange] = useState({ startIndex: 0, endIndex: 0 });
  const [visibleVerticalRange, setVisibleVerticalRange] = useState<VerticalRange>({
    start: 0,
    end: Number.POSITIVE_INFINITY,
  });

  const hasReservationInVisiblePeriod = useMemo(
    () => placed.some((item) => timelineRangesOverlap(item, visibleDayRange)),
    [placed, visibleDayRange],
  );

  const nearestReservation = useMemo(
    () => findNearestTimelineItem(placed, visibleDayRange),
    [placed, visibleDayRange],
  );

  const verticalReservationNavigation = useMemo(() => {
    let above: (typeof placed)[number] | null = null;
    let below: (typeof placed)[number] | null = null;
    let hasVisibleReservation = false;

    for (const item of placed) {
      if (!timelineRangesOverlap(item, visibleDayRange)) continue;

      const top = item.laneIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
      const bottom = top + BAR_HEIGHT;

      if (bottom <= visibleVerticalRange.start) {
        if (above === null || item.laneIndex > above.laneIndex) {
          above = item;
        }
      } else if (top >= visibleVerticalRange.end) {
        if (below === null || item.laneIndex < below.laneIndex) {
          below = item;
        }
      } else {
        hasVisibleReservation = true;
      }
    }

    return hasVisibleReservation ? { above: null, below: null } : { above, below };
  }, [placed, visibleDayRange, visibleVerticalRange]);

  const showEmptyVisiblePeriod =
    hasCompletedInitialLoad && !hasError && !hasReservationInVisiblePeriod;

  // ---------------------------------------------------------------------------
  // Scrolling: initial position, label sync, infinite extension
  // ---------------------------------------------------------------------------

  const updateVisibleViewport = (element: HTMLDivElement) => {
    const leftmostIndex = Math.max(
      0,
      Math.min(daysCount - 1, Math.floor(element.scrollLeft / dayWidth)),
    );
    const rightmostIndex = Math.max(
      leftmostIndex,
      Math.min(daysCount - 1, Math.ceil((element.scrollLeft + element.clientWidth) / dayWidth) - 1),
    );
    const centerOffset = element.scrollLeft + element.clientWidth / 2;
    const index = Math.max(0, Math.min(daysCount - 1, Math.floor(centerOffset / dayWidth)));
    const centeredDate = addDays(windowStart, index);
    const label = formatMonthLabel(centeredDate);
    setVisibleDayRange((previous) =>
      previous.startIndex === leftmostIndex && previous.endIndex === rightmostIndex
        ? previous
        : { startIndex: leftmostIndex, endIndex: rightmostIndex },
    );
    const verticalStart = element.scrollTop;
    const verticalEnd = verticalStart + Math.max(0, element.clientHeight - HEADER_HEIGHT);
    setVisibleVerticalRange((previous) =>
      previous.start === verticalStart && previous.end === verticalEnd
        ? previous
        : { start: verticalStart, end: verticalEnd },
    );
    setVisibleDate((previous) =>
      previous.getTime() === centeredDate.getTime() ? previous : centeredDate,
    );
    setVisibleMonthLabel((previous) => (previous === label ? previous : label));
  };

  const centerInitialAnchorDate = (element: HTMLDivElement) => {
    // A timeline view can mount while hidden during client-side navigation.
    // Wait for its real width instead of permanently consuming the initial scroll.
    if (element.clientWidth === 0 || element.scrollWidth <= element.clientWidth) return false;

    const anchorIndex = diffInDays(windowStart, anchorDateRef.current);
    const target = (anchorIndex + 0.5) * dayWidth - element.clientWidth / 2;
    element.scrollLeft = Math.max(0, target);
    didInitialScrollRef.current = true;
    updateVisibleViewport(element);
    return true;
  };

  // Center the anchor date on first mount (and again after a window reset)
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element || didInitialScrollRef.current) return;
    centerInitialAnchorDate(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  // Compensate scroll position after prepending days
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element || pendingPrependRef.current === 0) return;
    element.scrollLeft += pendingPrependRef.current * dayWidth;
    pendingPrependRef.current = 0;
    updateVisibleViewport(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  // Keep the leftmost visible day stable across zoom changes
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element || zoomAnchorRef.current === null) return;
    element.scrollLeft = zoomAnchorRef.current * dayWidth;
    zoomAnchorRef.current = null;
    updateVisibleViewport(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(() => {
      if (!didInitialScrollRef.current && centerInitialAnchorDate(element)) return;
      updateVisibleViewport(element);
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayWidth, daysCount, windowStart]);

  useEffect(() => {
    appendLockRef.current = false;
  }, [daysCount]);

  // When the empty state points to a reservation near a loaded edge, extend
  // that edge in the background before the user clicks. Otherwise the click's
  // smooth scroll triggers infinite loading, shifts the timeline, and leaves
  // the user needing a second click to reach the reservation.
  useEffect(() => {
    const element = scrollerRef.current;
    if (
      !showEmptyVisiblePeriod ||
      !nearestReservation ||
      isFetching ||
      daysCount >= MAX_DAYS_COUNT ||
      !element
    ) {
      return;
    }

    const direction = getTimelineNavigationBufferDirection({
      item: nearestReservation.item,
      dayWidth,
      daysCount,
      viewportWidth: element.clientWidth,
      edgeThreshold: EXTEND_THRESHOLD_PX,
    });

    if (direction === "previous" && pendingPrependRef.current === 0) {
      pendingPrependRef.current = EXTEND_CHUNK_DAYS;
      setWindowStart((previous) => addDays(previous, -EXTEND_CHUNK_DAYS));
      setDaysCount((previous) => previous + EXTEND_CHUNK_DAYS);
    } else if (direction === "next" && !appendLockRef.current) {
      appendLockRef.current = true;
      setDaysCount((previous) => previous + EXTEND_CHUNK_DAYS);
    }
  }, [dayWidth, daysCount, isFetching, nearestReservation, showEmptyVisiblePeriod]);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    },
    [],
  );

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateVisibleViewport(element);

      if (daysCount >= MAX_DAYS_COUNT) return;

      const maxScrollLeft = element.scrollWidth - element.clientWidth;

      if (element.scrollLeft < EXTEND_THRESHOLD_PX && pendingPrependRef.current === 0) {
        pendingPrependRef.current = EXTEND_CHUNK_DAYS;
        setWindowStart((previous) => addDays(previous, -EXTEND_CHUNK_DAYS));
        setDaysCount((previous) => previous + EXTEND_CHUNK_DAYS);
      } else if (
        maxScrollLeft - element.scrollLeft < EXTEND_THRESHOLD_PX &&
        !appendLockRef.current
      ) {
        appendLockRef.current = true;
        setDaysCount((previous) => previous + EXTEND_CHUNK_DAYS);
      }
    });
  };

  const scrollByDays = (dayCount: number) => {
    scrollerRef.current?.scrollBy({
      left: dayCount * dayWidth,
      behavior: "smooth",
    });
  };

  const scrollToReservationLane = (laneIndex: number) => {
    const element = scrollerRef.current;
    if (!element) return;

    const viewportHeight = Math.max(0, element.clientHeight - HEADER_HEIGHT);
    const reservationTop = laneIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const target = reservationTop - Math.max(0, (viewportHeight - BAR_HEIGHT) / 2);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    element.scrollTo({
      top: Math.max(0, target),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  const forwardEmptyStateWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = scrollerRef.current;
    if (!element) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaX, top: event.deltaY });
  };

  const goToDate = (date: Date, behavior: ScrollBehavior = "smooth") => {
    const element = scrollerRef.current;
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const targetIndex = diffInDays(windowStart, targetDate);
    anchorDateRef.current = targetDate;

    if (element && targetIndex >= 0 && targetIndex < daysCount) {
      const target = (targetIndex + 0.5) * dayWidth - element.clientWidth / 2;
      const left = Math.max(0, target);
      if (behavior === "auto") {
        element.scrollLeft = left;
        updateVisibleViewport(element);
      } else {
        element.scrollTo({ left, behavior });
      }
      return;
    }

    // The chosen date fell outside the loaded window — reset around it.
    pendingPrependRef.current = 0;
    appendLockRef.current = false;
    didInitialScrollRef.current = false;
    const initialWindow = reservationCalendarQueries.initialWindow(targetDate);
    setWindowStart(initialWindow.start);
    setDaysCount(initialWindow.daysCount);
  };

  const goToToday = () => goToDate(new Date(), "auto");

  // Browser/Next scroll restoration can run after layout effects on a cached
  // navigation. Re-apply any URL anchor after paint so it wins over an older
  // horizontal scroll position restored by the browser.
  useEffect(() => {
    const targetDate = parseCalendarDateParam(dateParam ?? undefined);
    if (!targetDate) return;

    let finalFrame = 0;
    const initialFrame = requestAnimationFrame(() => {
      finalFrame = requestAnimationFrame(() => {
        goToDate(targetDate, "auto");
      });
    });

    return () => {
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(finalFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateParam]);

  const persistVisibleDate = () => {
    persistCalendarDateInHistory(visibleDate);
  };

  // ---------------------------------------------------------------------------
  // Drag-to-create (mouse only — touch keeps native scrolling)
  // ---------------------------------------------------------------------------

  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const dragAnchorRef = useRef<DragAnchor | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dragAnchorRef.current === null) return;

      event.preventDefault();
      dragAnchorRef.current = null;
      dragSelectionRef.current = null;
      setDragSelection(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const dayIndexFromPointer = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return Math.max(0, Math.min(daysCount - 1, Math.floor(x / dayWidth)));
  };

  const handleLanePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    // Ignore presses on reservation bars — those are links.
    if ((event.target as HTMLElement).closest("a")) return;

    const index = dayIndexFromPointer(event);
    dragAnchorRef.current = {
      dayIndex: index,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    dragSelectionRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleLanePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const anchor = dragAnchorRef.current;
    if (!anchor) return;

    const distance = Math.hypot(event.clientX - anchor.clientX, event.clientY - anchor.clientY);
    if (dragSelectionRef.current === null && distance < DRAG_START_THRESHOLD_PX) return;

    const index = dayIndexFromPointer(event);
    const selection = {
      startIndex: Math.min(anchor.dayIndex, index),
      endIndex: Math.max(anchor.dayIndex, index),
    };
    dragSelectionRef.current = selection;
    setDragSelection(selection);
  };

  const handleLanePointerUp = () => {
    const selection = dragSelectionRef.current;
    dragAnchorRef.current = null;
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (!selection) return;

    const start = addDays(windowStart, selection.startIndex);
    start.setHours(DRAG_CREATE_START_HOUR, 0, 0, 0);
    const end = addDays(windowStart, selection.endIndex);
    end.setHours(DRAG_CREATE_END_HOUR, 0, 0, 0);

    const params = new URLSearchParams({
      source: "calendar_timeline",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    router.push(`/dashboard/reservations/new?${params.toString()}`);
  };

  const handleLanePointerCancel = () => {
    dragAnchorRef.current = null;
    dragSelectionRef.current = null;
    setDragSelection(null);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const timelineWidth = daysCount * dayWidth;
  const bodyHeight = lanes * ROW_HEIGHT;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <TimelineToolbar
        products={products}
        filters={filters}
        currentDate={visibleDate}
        monthLabel={visibleMonthLabel}
        isFetching={isFetching && hasCompletedInitialLoad}
        onPrevious={() => scrollByDays(-NAV_DAYS[zoom])}
        onNext={() => scrollByDays(NAV_DAYS[zoom])}
        onToday={goToToday}
        onDateChange={goToDate}
        onRangeChange={handleZoomChange}
      />

      {hasError && (
        <Alert variant="error">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {tTimeline("loadError")}
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void retry()}>
              {tTimeline("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Timeline grid */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="bg-card absolute inset-0 overflow-auto overscroll-x-contain overscroll-y-none rounded-lg border select-none"
        >
          <div className="relative flex min-h-full flex-col" style={{ width: timelineWidth }}>
            {/* Sticky header: months + days */}
            <div
              className="bg-card sticky top-0 z-30 shrink-0 border-b"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Month row — labels stay pinned until pushed by the next month */}
              <div className="relative border-b" style={{ height: MONTH_ROW_HEIGHT }}>
                {monthSegments.map((segment) => (
                  <div
                    key={segment.startIndex}
                    className="absolute inset-y-0 flex items-center overflow-clip border-r whitespace-nowrap last:border-r-0"
                    style={{
                      left: segment.startIndex * dayWidth,
                      width: segment.days * dayWidth,
                    }}
                  >
                    <span className="text-muted-foreground sticky left-0 inline-block px-2 text-[11px] font-medium">
                      {formatMonthLabel(segment.date)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day row */}
              <div className="flex" style={{ height: DAY_ROW_HEIGHT }}>
                {days.map((date, index) => {
                  const isToday = index === todayIndex;
                  return (
                    <div
                      key={index}
                      className={cn(
                        "flex shrink-0 flex-col items-center justify-center",
                        isWeekend(date) && "bg-muted/40",
                        isToday && "bg-primary/10",
                      )}
                      style={{ width: dayWidth }}
                    >
                      {zoom !== "month" && (
                        <span
                          className={cn(
                            "text-[10px] font-medium uppercase",
                            isToday ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          {dayNameFormatter.format(date)}
                        </span>
                      )}
                      <span
                        className={cn(
                          "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
                          isToday && "bg-primary text-primary-foreground",
                        )}
                      >
                        {date.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Body */}
            <div className="relative flex-1" style={{ minHeight: bodyHeight }}>
              {/* Background: weekends + day grid lines + today */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage: [
                    // Keep day separators above the weekend tint and visible on mobile displays.
                    "linear-gradient(to right, color-mix(in srgb, var(--color-muted-foreground) 32%, transparent) 0, color-mix(in srgb, var(--color-muted-foreground) 32%, transparent) 0.5px, transparent 0.5px)",
                    // Weekend shading — windowStart is always Monday aligned.
                    `linear-gradient(to right, transparent 0, transparent ${5 * dayWidth}px, color-mix(in srgb, var(--color-muted) 45%, transparent) ${5 * dayWidth}px, color-mix(in srgb, var(--color-muted) 45%, transparent) ${7 * dayWidth}px)`,
                  ].join(", "),
                  // Explicit tiles avoid WebKit stretching repeating gradients on tall timelines.
                  backgroundSize: `${dayWidth}px 100%, ${7 * dayWidth}px 100%`,
                  backgroundRepeat: "repeat-x",
                }}
              >
                {/* Today column */}
                {todayIndex >= 0 && todayIndex < daysCount && (
                  <div
                    className="bg-primary/5 absolute inset-y-0"
                    style={{ left: todayIndex * dayWidth, width: dayWidth }}
                  />
                )}
              </div>

              {/* Lane area: drag-to-create + stacked reservation bars */}
              <div
                className="absolute inset-0 cursor-crosshair"
                onPointerDown={handleLanePointerDown}
                onPointerMove={handleLanePointerMove}
                onPointerUp={handleLanePointerUp}
                onPointerCancel={handleLanePointerCancel}
              >
                {/* Drag-to-create selection */}
                {dragSelection && (
                  <div
                    className="border-primary/60 bg-primary/10 pointer-events-none absolute inset-y-1 z-6 rounded-md border-2 border-dashed"
                    style={{
                      left: dragSelection.startIndex * dayWidth + 1,
                      width: (dragSelection.endIndex - dragSelection.startIndex + 1) * dayWidth - 2,
                    }}
                  />
                )}

                {/* Reservations */}
                {placed.map((item) => {
                  const from = Math.max(0, item.startIndex);
                  const to = Math.min(daysCount - 1, item.endIndex);
                  if (to < from) return null;

                  return (
                    <TimelineReservationBar
                      key={item.reservation.id}
                      reservation={item.reservation}
                      currency={currency}
                      onBeforeNavigate={persistVisibleDate}
                      isLabelSticky
                      continuesBeforeViewport={item.startIndex < visibleDayRange.startIndex}
                      style={{
                        left: from * dayWidth + 4,
                        width: (to - from + 1) * dayWidth - 8,
                        top: item.laneIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
                        height: BAR_HEIGHT,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {showInitialLoadingOverlay && (
          <div
            className="bg-card/60 absolute inset-x-px top-17 bottom-px z-50 flex items-center justify-center rounded-b-lg backdrop-blur-xs"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="relative flex size-16 items-center justify-center">
                <span
                  aria-hidden
                  className="border-muted border-t-primary motion-safe:animate-spin absolute inset-0 rounded-full border-2"
                />
                <ReservationsGlassIcon className="size-8" aria-hidden />
              </div>
              <p className="text-muted-foreground text-sm font-medium">
                {tTimeline("loadingReservations")}
              </p>
            </div>
          </div>
        )}

        {!showInitialLoadingOverlay && !showEmptyVisiblePeriod && !hasError && (
          <>
            {verticalReservationNavigation.above && (
              <Button
                variant="outline"
                size="sm"
                className="bg-card/95 absolute top-19 left-1/2 z-40 -translate-x-1/2 shadow-md backdrop-blur-xs"
                onClick={() => {
                  const reservation = verticalReservationNavigation.above;
                  if (!reservation) return;
                  scrollToReservationLane(reservation.laneIndex);
                }}
              >
                <ChevronUp />
                {tTimeline("reservationAbove")}
              </Button>
            )}
            {verticalReservationNavigation.below && (
              <Button
                variant="outline"
                size="sm"
                className="bg-card/95 absolute bottom-2 left-1/2 z-40 -translate-x-1/2 shadow-md backdrop-blur-xs"
                onClick={() => {
                  const reservation = verticalReservationNavigation.below;
                  if (!reservation) return;
                  scrollToReservationLane(reservation.laneIndex);
                }}
              >
                <ChevronDown />
                {tTimeline("reservationBelow")}
              </Button>
            )}
          </>
        )}

        {showEmptyVisiblePeriod && (
          <div className="bg-card/60 pointer-events-none absolute inset-x-0 top-17 bottom-0 z-20 flex items-center justify-center rounded-b-lg p-6 backdrop-blur-xs">
            <div
              className="bg-card/95 pointer-events-none flex w-full max-w-sm flex-col items-center rounded-xl border p-6 text-center shadow-lg"
              onWheel={forwardEmptyStateWheel}
            >
              <ReservationsGlassIcon className="mb-3 size-10" aria-hidden />
              <p className="text-sm font-semibold">
                {tTimeline(storeHasReservations ? "emptyPeriodTitle" : "emptyStoreTitle")}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {tTimeline(
                  storeHasReservations ? "emptyPeriodDescription" : "emptyStoreDescription",
                )}
              </p>
              {!storeHasReservations ? (
                <Button
                  render={<Link href="/dashboard/reservations/new?source=reservations_page" />}
                  variant="outline"
                  size="default"
                  className="pointer-events-auto mt-4"
                >
                  <Plus />
                  {tTimeline("createFirstReservation")}
                </Button>
              ) : (
                (filters.hasActiveFilters || nearestReservation) && (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {filters.hasActiveFilters && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="pointer-events-auto"
                        onClick={filters.resetFilters}
                      >
                        {tTimeline("resetFilters")}
                      </Button>
                    )}
                    {nearestReservation && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="pointer-events-auto"
                        isPending={isFetching}
                        onClick={() => {
                          const element = scrollerRef.current;
                          if (!element) return;

                          const reservationCenter =
                            (nearestReservation.item.startIndex +
                              nearestReservation.item.endIndex) /
                            2;
                          const target = reservationCenter * dayWidth - element.clientWidth / 2;
                          const reduceMotion = window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches;
                          element.scrollTo({
                            left: Math.max(0, target),
                            behavior: reduceMotion ? "auto" : "smooth",
                          });
                        }}
                      >
                        {tTimeline(
                          nearestReservation.direction === "previous"
                            ? "viewPreviousReservation"
                            : "viewNextReservation",
                        )}
                      </Button>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-muted-foreground hidden text-xs sm:block">{tTimeline("dragHint")}</p>
    </div>
  );
}
