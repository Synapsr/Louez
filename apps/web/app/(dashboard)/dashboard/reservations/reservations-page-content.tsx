"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Calendar, LayoutGrid, List, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsInteger, parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";

import {
  Button,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@louez/ui";
import { CalendarSyncIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { BlurOverlay, LimitBanner, UpgradeModal } from "@/components/dashboard/upgrade-modal";
import { createDashboardReturnTo } from "@/lib/dashboard/util.reservation-navigation";
import { orpc } from "@/lib/orpc/react";
import type { LimitStatus } from "@/lib/plan-limits";

import { RESERVATION_VIEWS, type ReservationView } from "./calendar/calendar-query";
import { CalendarExportModal } from "./calendar/calendar-export-modal";
import { ReservationsCalendarView } from "./calendar/calendar-view";
import { PlanningTimeline } from "./calendar/planning-timeline";
import type { Product as CalendarProduct } from "./calendar/types";
import { ReservationConfirmDialogs, useReservationActions } from "./reservations-actions";
import { ReservationsCardView } from "./reservations-card-view";
import { ReservationsFilters } from "./reservations-filters";
import { ReservationsPagination } from "./reservations-pagination";
import { ReservationsTableView } from "./reservations-table-view";
import { ReservationsViewSwitcher } from "./reservations-view-switcher";
import type {
  Reservation,
  ReservationCounts,
  SortDirection,
  SortField,
} from "./reservations-types";

interface ReservationsPageContentProps {
  view: ReservationView;
  restorePreferredView: boolean;
  currentStatus?: string;
  currentPeriod?: string;
  currentPaymentMethod?: string;
  initialData?: {
    reservations: Reservation[];
    counts: ReservationCounts;
    totalCount: number | null;
  };
  calendarData: {
    products: CalendarProduct[];
  };
  storeHasReservations: boolean;
  storeId: string;
  limits: LimitStatus;
  planSlug: string;
  currency?: string;
  timezone?: string;
}

export function ReservationsPageContent({
  view,
  restorePreferredView,
  currentStatus,
  currentPeriod,
  currentPaymentMethod,
  initialData,
  calendarData,
  storeHasReservations,
  storeId,
  limits,
  planSlug,
  currency,
  timezone,
}: ReservationsPageContentProps) {
  const t = useTranslations("dashboard.reservations");
  const tCalendar = useTranslations("dashboard.calendar");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [mountedTimelineViews, setMountedTimelineViews] = useState<
    Set<Exclude<ReservationView, "list">>
  >(() => (view === "list" ? new Set() : new Set([view])));
  const searchParams = useSearchParams();
  const router = useRouter();
  const [{ view: activeView }, setReservationViewState] = useQueryStates(
    {
      view: parseAsStringLiteral(RESERVATION_VIEWS).withDefault(view),
      page: parseAsInteger,
    },
    {
      history: "push",
      shallow: true,
      clearOnDefault: false,
    },
  );

  useEffect(() => {
    if (!restorePreferredView || searchParams.has("view")) return;

    let preferredView: ReservationView | undefined;
    try {
      const storedView = window.localStorage.getItem(`louez:reservations-view:v1:${storeId}`);
      preferredView = RESERVATION_VIEWS.find((candidate) => candidate === storedView);
    } catch {
      return;
    }

    if (!preferredView || preferredView === activeView) return;

    if (preferredView !== "list") {
      setMountedTimelineViews((mountedViews) => {
        if (mountedViews.has(preferredView)) return mountedViews;
        return new Set(mountedViews).add(preferredView);
      });
    }

    void setReservationViewState({ view: preferredView, page: null }, { history: "replace" });
  }, [activeView, restorePreferredView, searchParams, setReservationViewState, storeId]);

  // Read URL params
  const status = searchParams.get("status") || currentStatus || undefined;
  const period = searchParams.get("period") || currentPeriod || undefined;
  const operation = searchParams.get("operation") || undefined;
  const paymentMethod = searchParams.get("paymentMethod") || currentPaymentMethod || undefined;
  const search = searchParams.get("search") || undefined;
  const sortParam = searchParams.get("sort") as SortField | null;
  const sortDirectionParam = searchParams.get("sortDirection") as SortDirection | null;
  const pageParam = searchParams.get("page");
  const pageSizeParam = searchParams.get("pageSize");

  const currentSort = sortParam || undefined;
  const currentSortDirection = sortDirectionParam || "desc";
  const currentPage = pageParam ? parseInt(pageParam, 10) : 1;
  const currentPageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 25;

  const isListView = activeView === "list";

  // Filters, sort and page are all in the URL, so the current search string is
  // enough to put the user back on the exact list they left.
  const listReturnTo = useMemo(
    () => createDashboardReturnTo("/dashboard/reservations", searchParams),
    [searchParams],
  );

  // List display mode — cards are the historical default users know; the
  // table is opt-in. URL-persisted so links keep the chosen display.
  const [displayMode, setDisplayMode] = useQueryState(
    "display",
    parseAsStringLiteral(["cards", "table"] as const)
      .withDefault("cards")
      .withOptions({ history: "replace" }),
  );

  const handleViewChange = useCallback(
    (nextView: ReservationView) => {
      if (nextView === activeView) return;

      try {
        window.localStorage.setItem(`louez:reservations-view:v1:${storeId}`, nextView);
      } catch {
        // URL state remains the source of truth when browser storage is unavailable.
      }

      if (nextView !== "list") {
        setMountedTimelineViews((mountedViews) => {
          if (mountedViews.has(nextView)) return mountedViews;
          return new Set(mountedViews).add(nextView);
        });
      }
      void setReservationViewState({ view: nextView, page: null });
    },
    [activeView, setReservationViewState, storeId],
  );

  // Actions hook
  const { loadingAction, handleStatusChange, openRejectDialog, confirmDialogsProps } =
    useReservationActions();

  // Sort handler
  const handleSortChange = useCallback(
    (field: SortField) => {
      const params = new URLSearchParams(searchParams.toString());
      if (currentSort === field) {
        // Toggle direction
        const newDir = currentSortDirection === "desc" ? "asc" : "desc";
        params.set("sort", field);
        params.set("sortDirection", newDir);
      } else {
        params.set("sort", field);
        params.set("sortDirection", "desc");
      }
      params.delete("page"); // reset page on sort change
      router.push(`/dashboard/reservations?${params.toString()}`);
    },
    [searchParams, currentSort, currentSortDirection, router],
  );

  const reservationsQuery = useQuery({
    ...orpc.dashboard.reservations.list.queryOptions({
      input: {
        status:
          status === "all" ||
          status === "pending" ||
          status === "confirmed" ||
          status === "ongoing" ||
          status === "completed" ||
          status === "cancelled" ||
          status === "rejected" ||
          status === "quote"
            ? status
            : undefined,
        period: period === "today" || period === "week" || period === "month" ? period : undefined,
        operation: operation === "departure" || operation === "return" ? operation : undefined,
        paymentMethod:
          paymentMethod === "stripe" ||
          paymentMethod === "cash" ||
          paymentMethod === "card" ||
          paymentMethod === "transfer" ||
          paymentMethod === "check" ||
          paymentMethod === "other"
            ? paymentMethod
            : undefined,
        search: search || undefined,
        sort: currentSort,
        sortDirection: currentSortDirection as "asc" | "desc",
        page: currentPage,
        pageSize: currentPageSize,
      },
    }),
    initialData,
    placeholderData: (previousData) => previousData,
  });

  const reservations = reservationsQuery.data?.reservations ?? [];
  const counts: ReservationCounts = reservationsQuery.data?.counts ?? {
    all: 0,
    pending: 0,
    confirmed: 0,
    ongoing: 0,
    completed: 0,
    cancelled: 0,
    quote: 0,
  };
  const totalCount = reservationsQuery.data?.totalCount ?? null;

  // Determine which reservations to show vs blur
  const displayLimit = limits.limit;
  const hasLimit = displayLimit !== null;
  const isOverLimit = limits.isOverLimit;

  const visibleReservations =
    hasLimit && isOverLimit ? reservations.slice(0, displayLimit) : reservations;
  const blurredReservations = hasLimit && isOverLimit ? reservations.slice(displayLimit) : [];

  // Empty state
  const isEmpty = reservations.length === 0 && !search;

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16">
      <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Calendar className="text-muted-foreground h-8 w-8" />
      </div>
      <h3 className="text-lg font-semibold">{t("noReservations")}</h3>
      <p className="text-muted-foreground mt-2 max-w-sm text-center text-sm">
        {t("noReservationsDescription")}
      </p>
      <Button
        render={<Link href="/dashboard/reservations/new?source=reservations_page" />}
        className="mt-6"
      >
        {t("createReservation")}
      </Button>
    </div>
  );

  // Mobile always gets cards; on desktop the toggle picks cards or table.
  const renderReservations = (items: Reservation[]) => {
    const cards = (
      <ReservationsCardView
        reservations={items}
        currency={currency}
        timezone={timezone}
        returnTo={listReturnTo}
        loadingAction={loadingAction}
        handleStatusChange={handleStatusChange}
        openRejectDialog={openRejectDialog}
      />
    );

    if (displayMode === "cards") {
      return cards;
    }

    return (
      <>
        <div className="sm:hidden">{cards}</div>
        <div className="hidden sm:block">
          <ReservationsTableView
            reservations={items}
            currency={currency}
            timezone={timezone}
            returnTo={listReturnTo}
            currentSort={currentSort}
            currentSortDirection={currentSortDirection}
            onSortChange={handleSortChange}
            loadingAction={loadingAction}
            handleStatusChange={handleStatusChange}
            openRejectDialog={openRejectDialog}
          />
        </div>
      </>
    );
  };

  return (
    <div
      className={cn(
        isListView
          ? "space-y-6"
          : cn(
              // Fills the dashboard content box exactly. The subtracted height
              // mirrors the shell in app/(dashboard)/dashboard/layout.tsx:
              //   mobile — 3.5rem header + 1.5rem wrapper (py-4 pb-2)
              //   md+    — 3.5rem header + 3rem wrapper (py-6) + 1rem SidebarInset m-2
              // svh, not dvh: the shell root is h-svh, so dvh would overflow it
              // on mobile browsers whose URL bar collapses.
              "flex h-[calc(100svh-5rem)] flex-col gap-3 overflow-hidden md:h-[calc(100svh-7.5rem)] md:gap-6",
              activeView === "calendar" ? "min-h-[34rem]" : "min-h-0",
            ),
      )}
    >
      {/* Header — the title block is dropped on mobile, where the topbar
          breadcrumb already names the page and vertical space is scarce. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="hidden sm:block">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <ReservationsViewSwitcher view={activeView} onViewChange={handleViewChange} />
          {/* Pushes the actions to the far edge once the title is gone */}
          <div className="flex-1 sm:hidden" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setExportModalOpen(true)}
                    aria-label={tCalendar("export.button")}
                  />
                }
              >
                <CalendarSyncIcon className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{tCalendar("export.button")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            render={<Link href="/dashboard/reservations/new?source=reservations_page" />}
            aria-label={t("createReservation")}
            className="max-xl:size-9 max-xl:px-0"
          >
            <Plus className="h-4 w-4" />
            <span className="max-xl:hidden">{t("createReservation")}</span>
          </Button>
        </div>
      </div>

      {/* Limit Banner */}
      {hasLimit && (
        <LimitBanner
          limitType="reservations"
          current={limits.current}
          limit={limits.limit!}
          currentPlan={planSlug}
          onUpgradeClick={() => setShowUpgradeModal(true)}
        />
      )}

      {mountedTimelineViews.has("planning") && (
        <div className={activeView === "planning" ? "contents" : "hidden"}>
          <PlanningTimeline
            products={calendarData.products}
            currency={currency ?? "EUR"}
            storeId={storeId}
          />
        </div>
      )}

      {mountedTimelineViews.has("calendar") && (
        <div className={activeView === "calendar" ? "contents" : "hidden"}>
          <ReservationsCalendarView
            products={calendarData.products}
            currency={currency ?? "EUR"}
            storeHasReservations={storeHasReservations}
            storeId={storeId}
          />
        </div>
      )}

      {activeView === "list" && (
        <>
          {/* Filters */}
          <ReservationsFilters
            counts={counts}
            currentStatus={status}
            currentPeriod={period}
            currentPaymentMethod={paymentMethod}
            endSlot={
              <div className="hidden sm:block">
                <ToggleGroup
                  value={[displayMode]}
                  onValueChange={(value: string[]) => {
                    const selected = value[0];
                    if (!selected) return;
                    void setDisplayMode(selected as "cards" | "table");
                  }}
                >
                  <ToggleGroupItem value="cards" aria-label={t("displayCards")}>
                    <LayoutGrid className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="table" aria-label={t("displayTable")}>
                    <List className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            }
          />

          {/* Reservations List */}
          {isEmpty ? (
            renderEmptyState()
          ) : (
            <>
              {renderReservations(visibleReservations)}

              {/* Blurred Reservations Section */}
              {blurredReservations.length > 0 && (
                <div className="relative">
                  <div className="pointer-events-none opacity-60 blur-sm select-none">
                    {renderReservations(blurredReservations)}
                  </div>
                  <BlurOverlay
                    limitType="reservations"
                    currentPlan={planSlug}
                    onUpgradeClick={() => setShowUpgradeModal(true)}
                  />
                </div>
              )}

              {/* Pagination */}
              <ReservationsPagination
                totalCount={totalCount}
                currentPage={currentPage}
                currentPageSize={currentPageSize}
              />
            </>
          )}
        </>
      )}

      {/* Confirm Dialogs */}
      <ReservationConfirmDialogs {...confirmDialogsProps} />

      {/* Export / sync modal (ICS + Google Calendar) */}
      <CalendarExportModal
        open={exportModalOpen}
        onOpenChange={setExportModalOpen}
        storeId={storeId}
      />

      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        limitType="reservations"
        currentCount={limits.current}
        limit={limits.limit || 10}
        currentPlan={planSlug}
      />
    </div>
  );
}
