"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, UIEvent } from "react";

import { useRouter } from "next/navigation";

import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  LocateFixed,
  Wrench,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsArrayOf, parseAsStringLiteral, useQueryStates } from "nuqs";

import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Drawer,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@louez/ui";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";
import { cn, formatDateShort } from "@louez/utils";
import type { StockKind } from "@louez/types";

import { EmptyState } from "@/components/ui/empty-state";

import {
  type ProductTimelineDowntime,
  type ProductTimelineReservation,
  fetchProductReservationTimeline,
} from "../../reservation-timeline-actions";
import { TimelineDateJumpDrawer } from "@/app/(dashboard)/dashboard/reservations/calendar/timeline-date-jump-drawer";
import { TimelineFilterBadge } from "@/components/dashboard/reservations-timeline/timeline-filter-badge";
import {
  getStatusDotClass,
  getTimelineStatus,
  TimelineReservationBar,
} from "@/components/dashboard/reservations-timeline/timeline-reservation-bar";
import {
  type TimelineLane,
  addDays,
  computeDailyAvailability,
  computeMonthSegments,
  diffInDays,
  getMondayOf,
  isWeekend,
  placeDowntimes,
  placeReservations,
  stackReservations,
  startOfDay,
} from "@/components/dashboard/reservations-timeline/timeline-utils";

// =============================================================================
// Constants
// =============================================================================

const TIMELINE_ZOOMS = ["week", "twoWeeks", "month"] as const;
type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

const DAY_WIDTHS: Record<TimelineZoom, number> = {
  week: 96,
  twoWeeks: 60,
  month: 38,
};

/** Narrower columns so a phone viewport still shows a useful span of days */
const MOBILE_DAY_WIDTHS: Record<TimelineZoom, number> = {
  week: 54,
  twoWeeks: 38,
  month: 26,
};

/** Left label column — unit identifiers need more room than slot numbers */
const UNIT_COLUMN_WIDTHS = { tracked: 132, untracked: 84 };
const MOBILE_UNIT_COLUMN_WIDTHS = { tracked: 92, untracked: 60 };

/** Days scrolled per arrow click */
const NAV_DAYS: Record<TimelineZoom, number> = {
  week: 7,
  twoWeeks: 14,
  month: 30,
};

const ALL_STATUSES = [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "quote",
  "cancelled",
  "rejected",
  "declined",
] as const;

/** Terminal/negative statuses hidden by default to reduce noise */
const DEFAULT_HIDDEN_STATUSES = new Set(["cancelled", "rejected", "declined"]);
const DEFAULT_VISIBLE_STATUSES = ALL_STATUSES.filter(
  (status) => !DEFAULT_HIDDEN_STATUSES.has(status),
);

const MONTH_ROW_HEIGHT = 26;
const DAY_ROW_HEIGHT = 42;
const AVAILABILITY_ROW_HEIGHT = 22;
const ROW_HEIGHT = 44;
const BAR_HEIGHT = 30;
const MAX_BODY_HEIGHT = 440;

/**
 * Simple-stock products with more stock than this switch to an aggregated view:
 * reservations are stacked into as few rows as needed instead of one lane per
 * unit (200 chairs should not render 200 rows).
 */
const AGGREGATE_THRESHOLD = 12;
/** Minimum rows in aggregated mode so there's room to drag-create */
const MIN_AGGREGATE_ROWS = 2;

/** Prefilled times for drag-created reservations */
const DRAG_CREATE_START_HOUR = 9;
const DRAG_CREATE_END_HOUR = 18;
/** Prevent a click or tiny pointer jitter from starting a reservation */
const DRAG_START_THRESHOLD_PX = 4;

/** Days loaded initially before today (Monday aligned) */
const INITIAL_PAST_DAYS = 28;
const INITIAL_DAYS_COUNT = 84;
/** Days added per infinite-scroll extension (multiple of 7 keeps Monday alignment) */
const EXTEND_CHUNK_DAYS = 28;
/** Distance from an edge (px) that triggers an extension */
const EXTEND_THRESHOLD_PX = 320;
/** Hard cap on the loaded window to keep the DOM bounded */
const MAX_DAYS_COUNT = 560;

// =============================================================================
// Filter controls — shared between the desktop toolbar row and the mobile
// filter drawer, so both always offer exactly the same choices.
// =============================================================================

/**
 * Visible statuses, but only once the selection is non-default — the default
 * set already hides the terminal statuses, and badging that made the toolbar
 * read as "5 filters active" on a timeline nobody had touched.
 */
function visibleStatusBadgeCount(hiddenStatuses: Set<string>): number | null {
  const visible = ALL_STATUSES.filter((status) => !hiddenStatuses.has(status));
  const isCustom =
    visible.length !== DEFAULT_VISIBLE_STATUSES.length ||
    DEFAULT_VISIBLE_STATUSES.some((status) => !visible.includes(status));

  return isCustom ? visible.length : null;
}

function StatusFilterList({
  hiddenStatuses,
  onToggleStatus,
  onSetVisibleStatuses,
}: {
  hiddenStatuses: Set<string>;
  onToggleStatus: (status: string) => void;
  onSetVisibleStatuses: (visible: Set<string>) => void;
}) {
  const t = useTranslations("dashboard.products.detail.reservations.timeline");
  const tCalendar = useTranslations("dashboard.calendar");

  return (
    <div className="space-y-0.5">
      {ALL_STATUSES.map((status) => (
        <Label
          key={status}
          className="hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal"
        >
          <Checkbox
            checked={!hiddenStatuses.has(status)}
            onCheckedChange={() => onToggleStatus(status)}
          />
          <span className={cn("h-2 w-2 shrink-0 rounded-full", getStatusDotClass(status))} />
          <span className="flex-1">{tCalendar(`status.${status}`)}</span>
        </Label>
      ))}
      {hiddenStatuses.size > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          onClick={() => onSetVisibleStatuses(new Set(ALL_STATUSES))}
        >
          {t("showAll")}
        </Button>
      )}
    </div>
  );
}

function ZoomSelect({
  zoom,
  onZoomChange,
  className,
  size,
}: {
  zoom: TimelineZoom;
  onZoomChange: (value: string | null) => void;
  className?: string;
  size?: "sm";
}) {
  const tCalendar = useTranslations("dashboard.calendar");

  return (
    <Select value={zoom} onValueChange={onZoomChange}>
      <SelectTrigger size={size} className={className} aria-label={tCalendar("viewMode.label")}>
        <CalendarIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" />
        <SelectValue>{tCalendar(`periods.${zoom}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TIMELINE_ZOOMS.map((period) => (
          <SelectItem key={period} value={period} label={tCalendar(`periods.${period}`)}>
            {tCalendar(`periods.${period}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Mobile filter drawer — the same trade as the planning timeline: a phone
 * toolbar can't hold the controls next to the date navigation, so they move
 * behind one trigger and the navigation keeps the visible slot.
 */
function TimelineFiltersDrawer({
  hiddenStatuses,
  zoom,
  onToggleStatus,
  onSetVisibleStatuses,
  onZoomChange,
}: {
  hiddenStatuses: Set<string>;
  zoom: TimelineZoom;
  onToggleStatus: (status: string) => void;
  onSetVisibleStatuses: (visible: Set<string>) => void;
  onZoomChange: (value: string | null) => void;
}) {
  const tCalendar = useTranslations("dashboard.calendar");
  const tTimeline = useTranslations("dashboard.calendar.timeline");
  const [open, setOpen] = useState(false);
  const badgeCount = visibleStatusBadgeCount(hiddenStatuses);

  return (
    <Drawer position="bottom" open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        render={<Button variant="outline" size="icon" aria-label={tTimeline("filters")} />}
      >
        <ListFilter />
        <TimelineFilterBadge count={badgeCount} />
      </DrawerTrigger>
      <DrawerPopup>
        <DrawerHeader>
          <DrawerTitle>{tTimeline("filters")}</DrawerTitle>
          <DrawerDescription>{tTimeline("filtersDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="space-y-5">
          <section className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {tCalendar("viewMode.label")}
            </p>
            <ZoomSelect zoom={zoom} onZoomChange={onZoomChange} className="w-full" />
          </section>

          <section className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {tTimeline("sectionStatus")}
            </p>
            <StatusFilterList
              hiddenStatuses={hiddenStatuses}
              onToggleStatus={onToggleStatus}
              onSetVisibleStatuses={onSetVisibleStatuses}
            />
          </section>
        </DrawerPanel>
        <DrawerFooter>
          <Button
            variant="outline"
            disabled={badgeCount === null}
            onClick={() => {
              onSetVisibleStatuses(new Set(DEFAULT_VISIBLE_STATUSES));
              setOpen(false);
            }}
          >
            {tTimeline("resetFilters")}
          </Button>
          <DrawerClose render={<Button />}>{tTimeline("applyFilters")}</DrawerClose>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
}

// =============================================================================
// Component
// =============================================================================

interface TimelineRow {
  key: string;
  /** Null in aggregated mode (stacked rows have no unit identity) */
  label: string | null;
}

interface DragSelection {
  rowIndex: number;
  startIndex: number;
  endIndex: number;
}

interface DragAnchor {
  rowIndex: number;
  dayIndex: number;
  clientX: number;
  clientY: number;
}

interface ProductReservationsTimelineProps {
  productId: string;
  currency: string;
  trackUnits: boolean;
  stockKind: StockKind;
  /** Active tracked units (empty for simple-quantity products) */
  units: { id: string; identifier: string }[];
  /** Stock quantity for simple-quantity products */
  quantity: number;
}

export function ProductReservationsTimeline({
  productId,
  currency,
  trackUnits,
  stockKind,
  units,
  quantity,
}: ProductReservationsTimelineProps) {
  const t = useTranslations("dashboard.products.detail.reservations.timeline");
  const tCalendar = useTranslations("dashboard.calendar");
  const tDowntime = useTranslations("dashboard.inventory.downtimeReasons");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();

  // ---------------------------------------------------------------------------
  // URL-persisted view state (zoom + status filter) — shareable links
  // ---------------------------------------------------------------------------

  const [urlState, setUrlState] = useQueryStates(
    {
      resaZoom: parseAsStringLiteral(TIMELINE_ZOOMS).withDefault("week"),
      resaStatus: parseAsArrayOf(parseAsStringLiteral(ALL_STATUSES)).withDefault(
        DEFAULT_VISIBLE_STATUSES,
      ),
    },
    { history: "replace" },
  );

  const zoom = urlState.resaZoom;
  const isMobile = useIsMobile();
  const dayWidth = (isMobile ? MOBILE_DAY_WIDTHS : DAY_WIDTHS)[zoom];

  const hiddenStatuses = useMemo(
    () => new Set<string>(ALL_STATUSES.filter((status) => !urlState.resaStatus.includes(status))),
    [urlState.resaStatus],
  );

  // Keep canonical status order so nuqs' clearOnDefault recognizes the
  // default set and drops the param from the URL.
  const setVisibleStatuses = (visible: Set<string>) => {
    void setUrlState({
      resaStatus: ALL_STATUSES.filter((status) => visible.has(status)),
    });
  };

  const toggleStatus = (status: string) => {
    const visible = new Set<string>(urlState.resaStatus);
    if (visible.has(status)) {
      visible.delete(status);
    } else {
      visible.add(status);
    }
    setVisibleStatuses(visible);
  };

  // ---------------------------------------------------------------------------
  // Window state (infinite horizontal scroll)
  // ---------------------------------------------------------------------------

  const [windowStart, setWindowStart] = useState(() =>
    getMondayOf(addDays(new Date(), -INITIAL_PAST_DAYS)),
  );
  const [daysCount, setDaysCount] = useState(INITIAL_DAYS_COUNT);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingPrependRef = useRef(0);
  const appendLockRef = useRef(false);
  const zoomAnchorRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const centeredForMobileRef = useRef(false);
  /** Date the viewport centers on when the window is (re)built */
  const anchorDateRef = useRef(startOfDay(new Date()));

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  const [reservationsById, setReservationsById] = useState<Map<string, ProductTimelineReservation>>(
    () => new Map(),
  );
  const [downtimesById, setDowntimesById] = useState<Map<string, ProductTimelineDowntime>>(
    () => new Map(),
  );
  const [isFetching, setIsFetching] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const coverageRef = useRef<{ start: number; end: number } | null>(null);
  const pendingFetchesRef = useRef(0);

  // NOTE: no cleanup/cancellation here on purpose. Coverage is claimed before
  // fetching so overlapping effect runs don't refetch the same range; if a run
  // discarded its results on re-render (infinite-scroll extension, StrictMode
  // double-mount), the range would stay claimed but empty forever. Merging is
  // idempotent (Maps keyed by id), so late results are always safe to apply.
  useEffect(() => {
    const winStart = windowStart;
    const winEnd = addDays(windowStart, daysCount - 1);
    winEnd.setHours(23, 59, 59, 999);

    const coverage = coverageRef.current;
    const gaps: Array<[Date, Date]> = [];

    if (!coverage) {
      gaps.push([winStart, winEnd]);
    } else {
      if (winStart.getTime() < coverage.start) {
        gaps.push([winStart, new Date(coverage.start)]);
      }
      if (winEnd.getTime() > coverage.end) {
        gaps.push([new Date(coverage.end), winEnd]);
      }
    }

    if (gaps.length === 0) return;

    // Claimed before fetching; rolled back on failure so a retry refetches.
    const previousCoverage = coverage;
    coverageRef.current = {
      start: Math.min(winStart.getTime(), coverage?.start ?? Infinity),
      end: Math.max(winEnd.getTime(), coverage?.end ?? -Infinity),
    };

    pendingFetchesRef.current += 1;
    setIsFetching(true);
    setError(null);

    void Promise.all(
      gaps.map(([start, end]) =>
        fetchProductReservationTimeline({
          productId,
          startDateISO: start.toISOString(),
          endDateISO: end.toISOString(),
        }),
      ),
    )
      .then((results) => {
        const failed = results.find((result) => "error" in result);
        if (failed && "error" in failed) {
          coverageRef.current = previousCoverage;
          setError(failed.error);
          return;
        }

        setReservationsById((previous) => {
          const next = new Map(previous);
          for (const result of results) {
            if (!("data" in result)) continue;
            for (const reservation of result.data.reservations) {
              next.set(reservation.id, reservation);
            }
          }
          return next;
        });
        setDowntimesById((previous) => {
          const next = new Map(previous);
          for (const result of results) {
            if (!("data" in result)) continue;
            for (const downtime of result.data.downtimes) {
              next.set(downtime.id, downtime);
            }
          }
          return next;
        });
        setHasLoadedOnce(true);
      })
      .catch(() => {
        coverageRef.current = previousCoverage;
        setError("errors.generic");
      })
      .finally(() => {
        pendingFetchesRef.current -= 1;
        if (pendingFetchesRef.current === 0) setIsFetching(false);
      });
  }, [productId, windowStart, daysCount, retryToken]);

  // ---------------------------------------------------------------------------
  // Derived layout data
  // ---------------------------------------------------------------------------

  /** Unlimited and high-quantity simple stock render stacked, not one lane per unit. */
  const isUntrackedStock = stockKind === "untracked";
  const isAggregated =
    isUntrackedStock || (!trackUnits && quantity > AGGREGATE_THRESHOLD);

  const lanes = useMemo((): TimelineLane[] => {
    if (trackUnits) {
      return units.map((unit) => ({
        key: unit.id,
        unitId: unit.id,
        label: unit.identifier,
      }));
    }

    if (isAggregated) return [];

    return Array.from({ length: Math.max(1, quantity) }, (_, index) => ({
      key: `slot-${index}`,
      unitId: null,
      label: `#${index + 1}`,
    }));
  }, [trackUnits, units, quantity, isAggregated]);

  const totalUnits = trackUnits ? lanes.length : Math.max(1, quantity);
  const headerHeight =
    MONTH_ROW_HEIGHT +
    DAY_ROW_HEIGHT +
    (isUntrackedStock ? 0 : AVAILABILITY_ROW_HEIGHT);
  const unitColumnWidth = (isMobile ? MOBILE_UNIT_COLUMN_WIDTHS : UNIT_COLUMN_WIDTHS)[
    trackUnits ? "tracked" : "untracked"
  ];

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, index) => addDays(windowStart, index)),
    [windowStart, daysCount],
  );

  const allReservations = useMemo(() => Array.from(reservationsById.values()), [reservationsById]);

  const visibleReservations = useMemo(
    () =>
      allReservations.filter(
        (reservation) => !hiddenStatuses.has(getTimelineStatus(reservation.status)),
      ),
    [allReservations, hiddenStatuses],
  );

  const placedDowntimes = useMemo(
    () =>
      placeDowntimes({
        downtimes: Array.from(downtimesById.values()),
        lanes,
        windowStart,
        daysCount,
      }),
    [downtimesById, lanes, windowStart, daysCount],
  );

  const { placedReservations, rows } = useMemo((): {
    placedReservations: ReturnType<typeof placeReservations>;
    rows: TimelineRow[];
  } => {
    if (isAggregated) {
      const { placed, laneCount } = stackReservations({
        reservations: visibleReservations,
        windowStart,
      });
      const rowCount = Math.max(laneCount, MIN_AGGREGATE_ROWS);
      return {
        placedReservations: placed,
        rows: Array.from({ length: rowCount }, (_, index) => ({
          key: `stack-${index}`,
          label: null,
        })),
      };
    }

    return {
      placedReservations: placeReservations({
        reservations: visibleReservations,
        lanes,
        placedDowntimes,
        windowStart,
      }),
      rows: lanes.map((lane) => ({ key: lane.key, label: lane.label })),
    };
  }, [isAggregated, visibleReservations, lanes, placedDowntimes, windowStart]);

  // Availability always reflects real stock pressure (independent of the
  // status filter): blocking reservations + downtimes.
  const availability = useMemo(
    () =>
      computeDailyAvailability({
        reservations: allReservations,
        placedDowntimes,
        totalUnits,
        windowStart,
        daysCount,
      }),
    [allReservations, placedDowntimes, totalUnits, windowStart, daysCount],
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

  const [visibleMonthLabel, setVisibleMonthLabel] = useState(() => formatMonthLabel(new Date()));
  const [visibleDate, setVisibleDate] = useState(() => startOfDay(new Date()));
  const [leftmostVisibleDayIndex, setLeftmostVisibleDayIndex] = useState(0);

  // ---------------------------------------------------------------------------
  // Scrolling: initial position, label sync, infinite extension
  // ---------------------------------------------------------------------------

  const updateVisibleViewport = (element: HTMLDivElement) => {
    const leftmostIndex = Math.max(
      0,
      Math.min(daysCount - 1, Math.floor(element.scrollLeft / dayWidth)),
    );
    const centerOffset = element.scrollLeft + (element.clientWidth - unitColumnWidth) / 2;
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

  // Center the anchor date on mount, after a window reset (`goToDate` landing
  // outside the loaded range), and when the day width swaps with the viewport —
  // `useIsMobile` only resolves after hydration, so keeping the old scrollLeft
  // would leave the timeline parked on an arbitrary date.
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;

    // The day width swaps once `useIsMobile` resolves — recenter rather than
    // keep a scrollLeft that now points somewhere else.
    if (centeredForMobileRef.current !== isMobile) {
      centeredForMobileRef.current = isMobile;
      didInitialScrollRef.current = false;
    }
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;

    const anchorIndex = diffInDays(windowStart, anchorDateRef.current);
    const target = anchorIndex * dayWidth - Math.max(0, (element.clientWidth - unitColumnWidth) / 3);
    element.scrollLeft = Math.max(0, target);
    updateVisibleViewport(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart, isMobile]);

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

  const goToDate = (date: Date) => {
    const element = scrollerRef.current;
    const targetDate = startOfDay(date);
    const targetIndex = diffInDays(windowStart, targetDate);
    anchorDateRef.current = targetDate;

    if (element && targetIndex >= 0 && targetIndex < daysCount) {
      const target =
        targetIndex * dayWidth - Math.max(0, (element.clientWidth - unitColumnWidth) / 3);
      element.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
      return;
    }

    // The chosen date fell outside the loaded window — rebuild it around the
    // target so the fetch effect covers the new range.
    coverageRef.current = null;
    setReservationsById(new Map());
    setDowntimesById(new Map());
    setHasLoadedOnce(false);
    setIsFetching(true);
    didInitialScrollRef.current = false;
    setWindowStart(getMondayOf(addDays(targetDate, -INITIAL_PAST_DAYS)));
    setDaysCount(INITIAL_DAYS_COUNT);
  };

  const goToToday = () => goToDate(new Date());

  const handleZoomChange = (value: string | null) => {
    if (value === null) return;
    const element = scrollerRef.current;
    if (element) {
      zoomAnchorRef.current = element.scrollLeft / dayWidth;
    }
    void setUrlState({ resaZoom: value as TimelineZoom });
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

  const handleLanePointerDown = (rowIndex: number, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    // Ignore presses on reservation bars — those are links.
    if ((event.target as HTMLElement).closest("a")) return;

    const index = dayIndexFromPointer(event);
    dragAnchorRef.current = {
      rowIndex,
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
      rowIndex: anchor.rowIndex,
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
      source: "product_timeline",
      productId,
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

  if (trackUnits && lanes.length === 0) {
    return <EmptyState icon={CalendarIcon} title={t("noUnits")} />;
  }

  const timelineWidth = daysCount * dayWidth;
  const bodyHeight = rows.length * ROW_HEIGHT;

  return (
    <div className="space-y-2">
      {/* Toolbar — one row on mobile: navigation stays visible, the controls
          move into a drawer (same trade as the planning timeline) */}
      <div className="flex min-w-0 items-center gap-2 sm:flex-wrap">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className="max-sm:size-9"
            aria-label={t("previous")}
            onClick={() => scrollByDays(-NAV_DAYS[zoom])}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="sm:hidden"
            aria-label={tCalendar("today")}
            onClick={goToToday}
          >
            <LocateFixed />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="max-sm:size-9"
            aria-label={t("next")}
            onClick={() => scrollByDays(NAV_DAYS[zoom])}
          >
            <ChevronRight />
          </Button>
          <Button variant="outline" size="sm" className="max-sm:hidden" onClick={goToToday}>
            {tCalendar("today")}
          </Button>
        </div>

        {/* The grid's own header already repeats the month on mobile */}
        <span className="min-w-0 truncate text-sm font-medium first-letter:uppercase max-sm:hidden">
          {visibleMonthLabel}
        </span>

        {isFetching && hasLoadedOnce && (
          <Spinner className="text-muted-foreground size-3.5 shrink-0" />
        )}

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:hidden">
          <TimelineFiltersDrawer
            hiddenStatuses={hiddenStatuses}
            zoom={zoom}
            onToggleStatus={toggleStatus}
            onSetVisibleStatuses={setVisibleStatuses}
            onZoomChange={handleZoomChange}
          />
          <TimelineDateJumpDrawer currentDate={visibleDate} onDateChange={goToDate} />
        </div>

        <div className="ms-auto hidden shrink-0 items-center gap-1 sm:flex">
          <Popover>
            <PopoverTrigger
              render={<Button variant="outline" size="sm" aria-label={t("statusFilter")} />}
            >
              <ListFilter />
              <TimelineFilterBadge count={visibleStatusBadgeCount(hiddenStatuses)} />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52">
              <div className="p-1">
                <StatusFilterList
                  hiddenStatuses={hiddenStatuses}
                  onToggleStatus={toggleStatus}
                  onSetVisibleStatuses={setVisibleStatuses}
                />
              </div>
            </PopoverContent>
          </Popover>

          <ZoomSelect
            zoom={zoom}
            onZoomChange={handleZoomChange}
            size="sm"
            className="w-32 sm:w-36"
          />
        </div>
      </div>

      {error && (
        <Alert variant="error">
          <AlertDescription className="flex items-center justify-between gap-3">
            {tErrors(error.startsWith("errors.") ? error.replace("errors.", "") : "generic")}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setRetryToken((token) => token + 1);
              }}
            >
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Timeline grid */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="bg-card relative overflow-auto overscroll-x-contain rounded-lg border select-none"
        style={{ maxHeight: headerHeight + MAX_BODY_HEIGHT }}
      >
        <div className="relative" style={{ width: unitColumnWidth + timelineWidth }}>
          {/* Sticky header: months, days, availability */}
          <div className="bg-card sticky top-0 z-30 border-b" style={{ height: headerHeight }}>
            <div
              className="absolute top-0 bottom-0"
              style={{ left: unitColumnWidth, width: timelineWidth }}
            >
              {/* Month row — labels stay pinned until pushed by the next
                  month (overflow-clip keeps position:sticky working, unlike
                  overflow-hidden which creates a scroll container) */}
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
                      style={{ left: unitColumnWidth }}
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

              {/* Availability has no quantity dimension for untracked stock. */}
              {isUntrackedStock ? null : (
                <div
                  className="bg-muted/30 flex border-t"
                  style={{ height: AVAILABILITY_ROW_HEIGHT }}
                >
                  {availability.map((free, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex shrink-0 items-center justify-center text-[10px] leading-none tabular-nums",
                        free === 0
                          ? "text-destructive font-semibold"
                          : "text-muted-foreground",
                      )}
                      style={{ width: dayWidth }}
                      title={t("availableOn", {
                        count: free,
                        date: formatDateShort(days[index]),
                      })}
                    >
                      {hasLoadedOnce ? free : "·"}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Corner cell */}
            <div
              className="bg-card sticky left-0 z-40 flex h-full items-end border-r px-3 pb-1.5"
              style={{ width: unitColumnWidth }}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="text-muted-foreground text-xs font-medium">
                  {isUntrackedStock ? t("bookings") : t("stock")}
                </span>
                {isUntrackedStock ? null : (
                  <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none font-medium tabular-nums">
                    {totalUnits}
                  </span>
                )}
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
                left: unitColumnWidth,
                width: timelineWidth,
                backgroundImage: [
                  // Weekend shading — windowStart is always Monday aligned
                  `repeating-linear-gradient(to right, transparent 0, transparent ${5 * dayWidth}px, color-mix(in srgb, var(--color-muted) 45%, transparent) ${5 * dayWidth}px, color-mix(in srgb, var(--color-muted) 45%, transparent) ${7 * dayWidth}px)`,
                  // Day grid lines
                  `repeating-linear-gradient(to right, var(--color-border) 0, var(--color-border) 1px, transparent 1px, transparent ${dayWidth}px)`,
                ].join(", "),
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
            {!hasLoadedOnce && !error && (
              <div
                className="bg-muted/40 absolute inset-y-0 animate-pulse"
                style={{ left: unitColumnWidth, width: timelineWidth }}
              />
            )}

            {/* Unit lanes */}
            {rows.map((row, rowIndex) => (
              <div
                key={row.key}
                className="relative flex border-b last:border-b-0"
                style={{ height: ROW_HEIGHT }}
              >
                <div
                  className="bg-card sticky left-0 z-20 flex shrink-0 items-center border-r px-3"
                  style={{ width: unitColumnWidth }}
                >
                  {row.label !== null && (
                    <span
                      className={cn(
                        "truncate text-xs",
                        trackUnits ? "text-foreground font-medium" : "text-muted-foreground",
                      )}
                      title={row.label}
                    >
                      {row.label}
                    </span>
                  )}
                </div>

                <div
                  className="relative cursor-crosshair"
                  style={{ width: timelineWidth }}
                  onPointerDown={(event) => handleLanePointerDown(rowIndex, event)}
                  onPointerMove={handleLanePointerMove}
                  onPointerUp={handleLanePointerUp}
                  onPointerCancel={handleLanePointerCancel}
                >
                  {/* Drag-to-create selection */}
                  {dragSelection?.rowIndex === rowIndex && (
                    <div
                      className="border-primary/60 bg-primary/10 pointer-events-none absolute inset-y-1 z-6 rounded-md border-2 border-dashed"
                      style={{
                        left: dragSelection.startIndex * dayWidth + 1,
                        width:
                          (dragSelection.endIndex - dragSelection.startIndex + 1) * dayWidth - 2,
                      }}
                    />
                  )}

                  {/* Downtimes */}
                  {placedDowntimes
                    .filter((placed) => placed.laneIndex === rowIndex)
                    .map((placed) => {
                      const from = Math.max(0, placed.startIndex);
                      const to = Math.min(daysCount - 1, placed.endIndex);
                      if (to < from) return null;

                      return (
                        <div
                          key={placed.downtime.id}
                          className="text-muted-foreground absolute z-4 flex items-center gap-1 overflow-hidden rounded-md border border-dashed px-2 text-[11px]"
                          style={{
                            left: from * dayWidth + 2,
                            width: (to - from + 1) * dayWidth - 4,
                            top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                            height: BAR_HEIGHT,
                            backgroundImage:
                              "repeating-linear-gradient(45deg, transparent 0, transparent 5px, color-mix(in srgb, var(--color-muted-foreground) 14%, transparent) 5px, color-mix(in srgb, var(--color-muted-foreground) 14%, transparent) 7px)",
                          }}
                          title={`${tDowntime(placed.downtime.reason)} · ${formatDateShort(placed.downtime.startsAt)}${
                            placed.downtime.endsAt
                              ? ` – ${formatDateShort(placed.downtime.endsAt)}`
                              : ""
                          }`}
                        >
                          <Wrench className="h-3 w-3 shrink-0" />
                          <span className="truncate">{tDowntime(placed.downtime.reason)}</span>
                        </div>
                      );
                    })}

                  {/* Reservations */}
                  {placedReservations
                    .filter((placed) => placed.laneIndex === rowIndex)
                    .map((placed) => {
                      const from = Math.max(0, placed.startIndex);
                      const to = Math.min(daysCount - 1, placed.endIndex);
                      if (to < from) return null;

                      return (
                        <TimelineReservationBar
                          key={`${placed.reservation.id}-${rowIndex}`}
                          reservation={placed.reservation}
                          currency={currency}
                          isConflict={placed.isConflict}
                          isLabelSticky
                          stickyLabelOffset={unitColumnWidth}
                          continuesBeforeViewport={placed.startIndex < leftmostVisibleDayIndex}
                          style={{
                            left: from * dayWidth + 2,
                            width: (to - from + 1) * dayWidth - 4,
                            top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                            height: BAR_HEIGHT,
                          }}
                        />
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Drag-to-create is mouse-only, so the hint has no audience on a phone */}
      <p className="text-muted-foreground text-xs max-sm:hidden">{t("dragHint")}</p>
    </div>
  );
}
