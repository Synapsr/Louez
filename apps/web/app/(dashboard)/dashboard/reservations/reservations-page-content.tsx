"use client";

import { useCallback, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Calendar } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { BlurOverlay, LimitBanner, UpgradeModal } from "@/components/dashboard/upgrade-modal";
import { PushPrimer } from "@/components/dashboard/push-primer";

import { orpc } from "@/lib/orpc/react";
import type { LimitStatus } from "@/lib/plan-limits";

import { ReservationConfirmDialogs, useReservationActions } from "./reservations-actions";
import { ReservationsCardView } from "./reservations-card-view";
import { ReservationsFilters } from "./reservations-filters";
import { ReservationsPagination } from "./reservations-pagination";
import { ReservationsTableView } from "./reservations-table-view";
import type {
  Reservation,
  ReservationCounts,
  SortDirection,
  SortField,
} from "./reservations-types";

interface ReservationsPageContentProps {
  currentStatus?: string;
  currentPeriod?: string;
  initialData?: {
    reservations: Reservation[];
    counts: ReservationCounts;
    totalCount: number | null;
  };
  limits: LimitStatus;
  planSlug: string;
  currency?: string;
  timezone?: string;
}

export function ReservationsPageContent({
  currentStatus,
  currentPeriod,
  initialData,
  limits,
  planSlug,
  currency,
  timezone,
}: ReservationsPageContentProps) {
  const t = useTranslations("dashboard.reservations");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read URL params
  const status = searchParams.get("status") || currentStatus || undefined;
  const period = searchParams.get("period") || currentPeriod || undefined;
  const operation = searchParams.get("operation") || undefined;
  const search = searchParams.get("search") || undefined;
  const view = searchParams.get("view") || "cards";
  const sortParam = searchParams.get("sort") as SortField | null;
  const sortDirectionParam = searchParams.get("sortDirection") as SortDirection | null;
  const pageParam = searchParams.get("page");
  const pageSizeParam = searchParams.get("pageSize");

  const currentSort = sortParam || undefined;
  const currentSortDirection = sortDirectionParam || "desc";
  const currentPage = pageParam ? parseInt(pageParam, 10) : 1;
  const currentPageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 25;

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

  const isCardView = view === "cards";

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
        render={
          <Link href="/dashboard/reservations/new?source=reservations_page" />
        }
        className="mt-6"
      >
        {t("createReservation")}
      </Button>
    </div>
  );

  const renderReservations = (items: Reservation[]) => {
    if (isCardView) {
      return (
        <ReservationsCardView
          reservations={items}
          currency={currency}
          timezone={timezone}
          loadingAction={loadingAction}
          handleStatusChange={handleStatusChange}
          openRejectDialog={openRejectDialog}
        />
      );
    }

    return (
      <ReservationsTableView
        reservations={items}
        currency={currency}
        timezone={timezone}
        currentSort={currentSort}
        currentSortDirection={currentSortDirection}
        onSortChange={handleSortChange}
        loadingAction={loadingAction}
        handleStatusChange={handleStatusChange}
        openRejectDialog={openRejectDialog}
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Contextual nudge to enable push (reservations are the value moment) */}
      <PushPrimer />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
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

      {/* Filters */}
      <ReservationsFilters counts={counts} currentStatus={status} currentPeriod={period} />

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

      {/* Confirm Dialogs */}
      <ReservationConfirmDialogs {...confirmDialogsProps} />

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
