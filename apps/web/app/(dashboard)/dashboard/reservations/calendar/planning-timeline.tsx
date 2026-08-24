"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, UIEvent } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { useQueries } from "@tanstack/react-query";
import { CalendarIcon, ChevronDown, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription, Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { EmptyState } from "@/components/ui/empty-state";

import {
  getTimelineStatus,
  TimelineReservationBar,
} from "@/components/dashboard/reservations-timeline/timeline-reservation-bar";
import {
  type PlacedReservation,
  type TimelineLane,
  addDays,
  computeMonthSegments,
  diffInDays,
  formatDeliveryAddress,
  isWeekend,
  placeReservations,
  stackReservations,
} from "@/components/dashboard/reservations-timeline/timeline-utils";
import { createDashboardReturnTo } from "@/lib/dashboard/util.reservation-navigation";
import {
  type PlanningTimelineEntry,
  reservationPlanningQueries,
} from "@/lib/queries/reservation-planning.queries";

import { type CalendarRange, matchesTodayOperation, toCalendarDateParam } from "./calendar-query";
import { TimelineToolbar, useTimelineFilters } from "./timeline-toolbar";
import type { Product, StoreTimelineReservation } from "./types";
import { useTimelineDateParam } from "./use-timeline-date-param";

// =============================================================================
// Constants — mirror the product page timeline so both feel identical
// =============================================================================

type TimelineZoom = CalendarRange;

const DAY_WIDTHS: Record<TimelineZoom, number> = {
  week: 96,
  twoWeeks: 60,
  month: 38,
};

/** Days scrolled per arrow click */
const NAV_DAYS: Record<TimelineZoom, number> = {
  week: 7,
  twoWeeks: 14,
  month: 30,
};

const MONTH_ROW_HEIGHT = 26;
const DAY_ROW_HEIGHT = 42;
const HEADER_HEIGHT = MONTH_ROW_HEIGHT + DAY_ROW_HEIGHT;
const ROW_HEIGHT = 44;
const BAR_HEIGHT = 30;
const PRODUCT_COLUMN_WIDTH = 160;
/** Collapsible product title row above its unit rows */
const PRODUCT_HEADER_HEIGHT = 34;

/**
 * Above this stock, an untracked product renders stacked rows instead of one
 * row per unit (200 chairs should not render 200 rows) — same rule as the
 * product page timeline.
 */
const AGGREGATE_THRESHOLD = 12;
/** Minimum rows in aggregated mode so there's room to drag-create */
const MIN_AGGREGATE_ROWS = 2;

/** Collapsed products persist across visits */
const COLLAPSED_PRODUCTS_KEY = "planning-collapsed-products";

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
// Component
// =============================================================================

interface ProductBlock {
  product: Product;
  placed: PlacedReservation[];
  /** One row per unit, or stacked rows for high-quantity untracked stock */
  rows: { key: string; label: string | null }[];
  /** Shown on the collapsed header row */
  reservationCount: number;
  isCollapsed: boolean;
  /** Header row + (expanded ? unit rows : 0) */
  height: number;
}

interface DragSelection {
  productIndex: number;
  startIndex: number;
  endIndex: number;
}

interface DragAnchor {
  productIndex: number;
  dayIndex: number;
  clientX: number;
  clientY: number;
}

interface PlanningTimelineProps {
  products: Product[];
  currency: string;
  storeId: string;
}

/** Raw procedure row → the shape the timeline bars and tooltips consume. */
function toStoreTimelineReservation(row: PlanningTimelineEntry): StoreTimelineReservation {
  return {
    id: row.id,
    productId: row.productId,
    number: row.number,
    status: row.status,
    startDate: new Date(row.startDate),
    endDate: new Date(row.endDate),
    customerId: row.customerId,
    customerName: row.customerName,
    subtotalAmount: row.subtotalAmount,
    depositAmount: row.depositAmount,
    totalAmount: row.totalAmount,
    quantity: row.quantity,
    assignedUnitIds: row.assignedUnitIds,
    items: row.items,
    outboundDeliveryAddress: row.outboundDelivery
      ? formatDeliveryAddress(row.outboundDelivery)
      : null,
    returnDeliveryAddress: row.returnDelivery ? formatDeliveryAddress(row.returnDelivery) : null,
  };
}

export function PlanningTimeline({ products, currency, storeId }: PlanningTimelineProps) {
  const t = useTranslations("dashboard.calendar.timeline");
  const tCalendar = useTranslations("dashboard.calendar");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dateParam, setDateParam] = useTimelineDateParam();

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

  // Anchor on the `date` param when present (deep links, `returnTo` round-trips)
  const anchorDateRef = useRef(dateParam ?? new Date());

  const initialWindowRef = useRef(reservationPlanningQueries.initialWindow(anchorDateRef.current));

  const [windowStart, setWindowStart] = useState(initialWindowRef.current.start);
  const [daysCount, setDaysCount] = useState(initialWindowRef.current.daysCount);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingPrependRef = useRef(0);
  const appendLockRef = useRef(false);
  const zoomAnchorRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Data — React Query, one cached query per fixed 28-day chunk. Scrolling
  // mounts the next chunks; cached chunks render instantly, so navigating
  // through time never shows a loading state.
  // ---------------------------------------------------------------------------

  const chunkQueries = useMemo(
    () => reservationPlanningQueries.forWindow(storeId, windowStart, daysCount),
    [storeId, windowStart, daysCount],
  );

  const { entries, isFetching, hasError, retry } = useQueries({
    queries: chunkQueries,
    combine: (results) => {
      // A reservation overlapping two chunks comes back from both — key on the
      // (reservation, product) pair so it is placed exactly once.
      const byPair = new Map<string, StoreTimelineReservation>();
      for (const result of results) {
        for (const row of result.data ?? []) {
          byPair.set(`${row.id}_${row.productId}`, toStoreTimelineReservation(row));
        }
      }

      return {
        entries: Array.from(byPair.values()),
        isFetching: results.some((result) => result.isFetching),
        hasError: results.some((result) => result.isError),
        retry: () =>
          Promise.all(
            results.filter((result) => result.isError).map((result) => result.refetch()),
          ),
      };
    },
  });

  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);

  useEffect(() => {
    if (hasCompletedInitialLoad || isFetching) return;
    setHasCompletedInitialLoad(true);
  }, [hasCompletedInitialLoad, isFetching]);

  // ---------------------------------------------------------------------------
  // Derived layout data
  // ---------------------------------------------------------------------------

  const displayProducts = useMemo(() => {
    if (selectedProductIds.size === 0) return products;
    return products.filter((product) => selectedProductIds.has(product.id));
  }, [products, selectedProductIds]);

  // ---------------------------------------------------------------------------
  // Collapsed products — hydrated after mount so SSR and client markup match
  // ---------------------------------------------------------------------------

  const [collapsedProductIds, setCollapsedProductIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_PRODUCTS_KEY);
      if (stored) setCollapsedProductIds(new Set<string>(JSON.parse(stored) as string[]));
    } catch {
      // Unreadable or disabled storage just means "everything expanded"
    }
  }, []);

  const toggleProductCollapsed = (productId: string) => {
    setCollapsedProductIds((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      try {
        window.localStorage.setItem(COLLAPSED_PRODUCTS_KEY, JSON.stringify([...next]));
      } catch {
        // Persisting is best-effort
      }
      return next;
    });
  };

  const reservationsByProduct = useMemo(() => {
    const map = new Map<string, StoreTimelineReservation[]>();
    for (const reservation of entries) {
      if (!matchesTodayOperation(reservation, todayOperation)) continue;
      if (hiddenStatuses.has(getTimelineStatus(reservation.status))) continue;
      const list = map.get(reservation.productId) ?? [];
      list.push(reservation);
      map.set(reservation.productId, list);
    }
    return map;
  }, [entries, hiddenStatuses, todayOperation]);

  const blocks = useMemo((): ProductBlock[] => {
    return displayProducts.map((product) => {
      const reservations = reservationsByProduct.get(product.id) ?? [];
      const isCollapsed = collapsedProductIds.has(product.id);
      const units = product.units ?? [];
      const trackUnits = Boolean(product.trackUnits) && units.length > 0;
      const quantity = Math.max(1, product.quantity);

      // Stacked fallback: no unit identity, as few rows as the overlap needs
      if (!trackUnits && quantity > AGGREGATE_THRESHOLD) {
        const { placed, laneCount } = stackReservations({ reservations, windowStart });
        const rows = Array.from(
          { length: Math.max(laneCount, MIN_AGGREGATE_ROWS) },
          (_, index) => ({ key: `stack-${index}`, label: null }),
        );
        return {
          product,
          placed,
          rows,
          reservationCount: reservations.length,
          isCollapsed,
          height: PRODUCT_HEADER_HEIGHT + (isCollapsed ? 0 : rows.length * ROW_HEIGHT),
        };
      }

      // One row per unit — a free cell means a genuinely free unit that day
      const lanes: TimelineLane[] = trackUnits
        ? units.map((unit) => ({ key: unit.id, unitId: unit.id, label: unit.identifier }))
        : Array.from({ length: quantity }, (_, index) => ({
            key: `slot-${index}`,
            unitId: null,
            label: quantity > 1 ? `#${index + 1}` : tCalendar("productsView.unit"),
          }));

      return {
        product,
        // No downtime data store-wide — the product page timeline owns that view
        placed: placeReservations({ reservations, lanes, placedDowntimes: [], windowStart }),
        rows: lanes.map((lane) => ({ key: lane.key, label: lane.label })),
        reservationCount: reservations.length,
        isCollapsed,
        height: PRODUCT_HEADER_HEIGHT + (isCollapsed ? 0 : lanes.length * ROW_HEIGHT),
      };
    });
  }, [displayProducts, reservationsByProduct, windowStart, collapsedProductIds, tCalendar]);

  const bodyHeight = blocks.reduce((sum, block) => sum + block.height, 0);

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
  const [leftmostVisibleDayIndex, setLeftmostVisibleDayIndex] = useState(0);

  // ---------------------------------------------------------------------------
  // Scrolling: initial position, label sync, infinite extension
  // ---------------------------------------------------------------------------

  const updateVisibleViewport = (element: HTMLDivElement) => {
    const leftmostIndex = Math.max(
      0,
      Math.min(daysCount - 1, Math.floor(element.scrollLeft / dayWidth)),
    );
    const centerOffset = element.scrollLeft + (element.clientWidth - PRODUCT_COLUMN_WIDTH) / 2;
    const index = Math.max(0, Math.min(daysCount - 1, Math.floor(centerOffset / dayWidth)));
    const centeredDate = addDays(windowStart, index);
    const label = formatMonthLabel(centeredDate);
    setLeftmostVisibleDayIndex((previous) =>
      previous === leftmostIndex ? previous : leftmostIndex,
    );
    setVisibleDate((previous) =>
      previous.getTime() === centeredDate.getTime() ? previous : centeredDate,
    );
    setVisibleMonthLabel((previous) => (previous === label ? previous : label));
  };

  // Center the anchor date on first mount (and again after a window reset)
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;

    const anchorIndex = diffInDays(windowStart, anchorDateRef.current);
    const target =
      anchorIndex * dayWidth - Math.max(0, (element.clientWidth - PRODUCT_COLUMN_WIDTH) / 3);
    element.scrollLeft = Math.max(0, target);
    updateVisibleViewport(element);
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
    appendLockRef.current = false;
  }, [daysCount]);

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

  const goToDate = (date: Date, behavior: ScrollBehavior = "smooth") => {
    const element = scrollerRef.current;
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const targetIndex = diffInDays(windowStart, targetDate);
    anchorDateRef.current = targetDate;

    if (element && targetIndex >= 0 && targetIndex < daysCount) {
      const target =
        targetIndex * dayWidth - Math.max(0, (element.clientWidth - PRODUCT_COLUMN_WIDTH) / 3);
      const left = Math.max(0, target);
      if (behavior === "auto") {
        // Restoration jumps straight there: a smooth scroll across months
        // would animate the whole way and read as jank.
        element.scrollLeft = left;
        updateVisibleViewport(element);
      } else {
        element.scrollTo({ left, behavior });
      }
      return;
    }

    // The chosen date fell outside the loaded window — reset around it. Cached
    // chunks stay warm, so a jump back to a visited period renders instantly.
    pendingPrependRef.current = 0;
    appendLockRef.current = false;
    didInitialScrollRef.current = false;

    const nextWindow = reservationPlanningQueries.initialWindow(targetDate);
    setWindowStart(nextWindow.start);
    setDaysCount(nextWindow.daysCount);
  };

  const goToToday = () => goToDate(new Date());

  const handleZoomChange = (range: CalendarRange) => {
    const element = scrollerRef.current;
    if (element) {
      zoomAnchorRef.current = element.scrollLeft / dayWidth;
    }
    filters.setRange(range);
  };

  /** Timestamp of the last date this view itself wrote to the URL. */
  const persistedDateRef = useRef<number | null>(null);
  const dateParamTime = dateParam?.getTime() ?? null;

  // Browser/Next scroll restoration can run after layout effects on a cached
  // navigation. Re-apply any URL anchor after paint so it wins over an older
  // horizontal scroll position restored by the browser.
  useEffect(() => {
    if (dateParamTime === null) return;
    // Our own viewport writes echo back through the URL. Re-anchoring on them
    // would shift the scroll position the user is already looking at.
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
   */
  const persistVisibleDate = () => {
    const date = new Date(visibleDate);
    date.setHours(0, 0, 0, 0);
    persistedDateRef.current = date.getTime();
    void setDateParam(date);
  };

  // Rebuilt every render rather than read back from the URL: nuqs flushes URL
  // updates on a throttled macrotask, so a middle-click or a new-tab open can
  // beat the flush. This always carries the date currently on screen.
  const returnTo = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "planning");
    params.set("date", toCalendarDateParam(visibleDate));
    return createDashboardReturnTo("/dashboard/reservations", params);
  }, [searchParams, visibleDate]);

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

  const handleLanePointerDown = (
    productIndex: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    // Ignore presses on reservation bars — those are links.
    if ((event.target as HTMLElement).closest("a")) return;

    const index = dayIndexFromPointer(event);
    dragAnchorRef.current = {
      productIndex,
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
      productIndex: anchor.productIndex,
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

    const product = blocks[selection.productIndex]?.product;
    if (!product) return;

    const start = addDays(windowStart, selection.startIndex);
    start.setHours(DRAG_CREATE_START_HOUR, 0, 0, 0);
    const end = addDays(windowStart, selection.endIndex);
    end.setHours(DRAG_CREATE_END_HOUR, 0, 0, 0);

    const params = new URLSearchParams({
      source: "planning_timeline",
      productId: product.id,
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

  if (products.length === 0) {
    return <EmptyState icon={CalendarIcon} title={tCalendar("productsView.noProducts")} />;
  }

  const timelineWidth = daysCount * dayWidth;

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
          <AlertDescription className="flex items-center justify-between gap-3">
            {t("loadError")}
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void retry()}>
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Timeline grid */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="bg-card relative min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none rounded-lg border select-none"
      >
        <div className="relative" style={{ width: PRODUCT_COLUMN_WIDTH + timelineWidth }}>
          {/* Sticky header: months + days */}
          <div className="bg-card sticky top-0 z-30 border-b" style={{ height: HEADER_HEIGHT }}>
            <div
              className="absolute top-0 bottom-0"
              style={{ left: PRODUCT_COLUMN_WIDTH, width: timelineWidth }}
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
                    <span
                      className="text-muted-foreground sticky inline-block px-2 text-[11px] font-medium"
                      style={{ left: PRODUCT_COLUMN_WIDTH }}
                    >
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

            {/* Corner cell */}
            <div
              className="bg-card sticky left-0 z-40 flex h-full items-end border-r px-3 pb-1.5"
              style={{ width: PRODUCT_COLUMN_WIDTH }}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="text-muted-foreground text-xs font-medium">
                  {tCalendar("productsView.products")}
                </span>
                <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none font-medium tabular-nums">
                  {displayProducts.length}
                </span>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="relative" style={{ height: bodyHeight }}>
            {/* Background: weekends + day grid lines + today */}
            <div
              aria-hidden
              className="absolute inset-y-0"
              style={{
                left: PRODUCT_COLUMN_WIDTH,
                width: timelineWidth,
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

            {/* Initial loading shimmer */}
            {!hasCompletedInitialLoad && isFetching && !hasError && (
              <div
                className="bg-muted/40 absolute inset-y-0 animate-pulse"
                style={{ left: PRODUCT_COLUMN_WIDTH, width: timelineWidth }}
              />
            )}

            {/* Product blocks */}
            {blocks.map((block, productIndex) => (
              <div key={block.product.id} className="border-b last:border-b-0">
                {/* Product header — collapse toggle + stock badge */}
                <div className="flex" style={{ height: PRODUCT_HEADER_HEIGHT }}>
                  <button
                    type="button"
                    aria-expanded={!block.isCollapsed}
                    onClick={() => toggleProductCollapsed(block.product.id)}
                    className="bg-card hover:bg-muted/50 sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r px-2 text-left transition-colors"
                    style={{ width: PRODUCT_COLUMN_WIDTH }}
                  >
                    {block.isCollapsed ? (
                      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                    <ProductImage
                      src={block.product.images?.[0]}
                      alt=""
                      sizes="32px"
                      containerClassName="w-8 shrink-0 rounded-md"
                    />
                    <span
                      className="text-foreground min-w-0 flex-1 truncate text-xs font-medium"
                      title={block.product.name}
                    >
                      {block.product.name}
                    </span>
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none font-medium tabular-nums">
                      {block.product.quantity}
                    </span>
                  </button>

                  <div className="relative" style={{ width: timelineWidth }}>
                    {block.isCollapsed && block.reservationCount > 0 && (
                      <span className="text-muted-foreground absolute inset-y-0 left-0 flex items-center px-2 text-xs">
                        {tCalendar("productsView.reservationsCount", {
                          count: block.reservationCount,
                        })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Unit rows */}
                {!block.isCollapsed && (
                  <div className="flex" style={{ height: block.rows.length * ROW_HEIGHT }}>
                    <div
                      className="bg-card sticky left-0 z-20 shrink-0 border-r"
                      style={{ width: PRODUCT_COLUMN_WIDTH }}
                    >
                      {block.rows.map((row, rowIndex) => (
                        <div
                          key={row.key}
                          className={cn(
                            "text-muted-foreground flex items-center truncate pr-3 pl-7 text-xs",
                            rowIndex > 0 && "border-border/60 border-t",
                          )}
                          style={{ height: ROW_HEIGHT }}
                          title={row.label ?? undefined}
                        >
                          {row.label}
                        </div>
                      ))}
                    </div>

                    <div
                      className="relative cursor-crosshair"
                      style={{ width: timelineWidth }}
                      onPointerDown={(event) => handleLanePointerDown(productIndex, event)}
                      onPointerMove={handleLanePointerMove}
                      onPointerUp={handleLanePointerUp}
                      onPointerCancel={handleLanePointerCancel}
                    >
                      {/* Row separators */}
                      {block.rows.slice(1).map((row, index) => (
                        <div
                          key={row.key}
                          aria-hidden
                          className="border-border/60 absolute inset-x-0 border-t"
                          style={{ top: (index + 1) * ROW_HEIGHT }}
                        />
                      ))}

                      {/* Drag-to-create selection */}
                      {dragSelection?.productIndex === productIndex && (
                        <div
                          className="border-primary/60 bg-primary/10 pointer-events-none absolute inset-y-1 z-6 rounded-md border-2 border-dashed"
                          style={{
                            left: dragSelection.startIndex * dayWidth + 1,
                            width:
                              (dragSelection.endIndex - dragSelection.startIndex + 1) * dayWidth -
                              2,
                          }}
                        />
                      )}

                      {/* Reservations */}
                      {block.placed.map((placed) => {
                        const from = Math.max(0, placed.startIndex);
                        const to = Math.min(daysCount - 1, placed.endIndex);
                        if (to < from) return null;

                        return (
                          <TimelineReservationBar
                            key={`${placed.reservation.id}-${placed.laneIndex}`}
                            reservation={placed.reservation}
                            currency={currency}
                            onBeforeNavigate={persistVisibleDate}
                            returnTo={returnTo}
                            isLabelSticky
                            stickyLabelOffset={PRODUCT_COLUMN_WIDTH}
                            continuesBeforeViewport={placed.startIndex < leftmostVisibleDayIndex}
                            style={{
                              left: from * dayWidth + 2,
                              width: (to - from + 1) * dayWidth - 4,
                              top: placed.laneIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
                              height: BAR_HEIGHT,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-muted-foreground hidden text-xs sm:block">{t("dragHint")}</p>
    </div>
  );
}
