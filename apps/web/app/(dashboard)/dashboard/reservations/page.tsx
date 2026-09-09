import { PendingDateChangeRequests } from "@/components/reservations/pending-date-change-requests";
import { Suspense } from "react";

import { getDashboardReservationsList } from "@louez/api/services";
import { Skeleton } from "@louez/ui";

import { getStoreLimits, getStorePlan } from "@/lib/plan-limits";
import { getCurrentStore } from "@/lib/store-context";

import { parseReservationView } from "./calendar/calendar-query";
import { getCalendarProducts, getStoreHasReservations } from "./calendar/data";
import { ReservationsPageContent } from "./reservations-page-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

function ReservationsTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="rounded-md border">
        <div className="space-y-4 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ReservationsPageProps {
  searchParams: Promise<{
    view?: string;
    status?: string;
    period?: string;
    operation?: string;
    paymentMethod?: string;
    search?: string;
    sort?: string;
    sortDirection?: string;
    page?: string;
    pageSize?: string;
    display?: string;
    date?: string;
    range?: string;
    productId?: string;
    statuses?: string;
    restorePreferredView?: string;
  }>;
}

function normalizeStatus(value: string | undefined) {
  if (
    value === "all" ||
    value === "pending" ||
    value === "confirmed" ||
    value === "ongoing" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "rejected"
  ) {
    return value;
  }
  return undefined;
}

function normalizePeriod(value: string | undefined) {
  if (value === "today" || value === "week" || value === "month") return value;
  return undefined;
}

function normalizeOperation(value: string | undefined) {
  if (value === "departure" || value === "return") return value;
  return undefined;
}

function normalizePaymentMethod(value: string | undefined) {
  if (
    value === "stripe" ||
    value === "cash" ||
    value === "card" ||
    value === "transfer" ||
    value === "check" ||
    value === "other"
  ) {
    return value;
  }
  return undefined;
}

function normalizeSort(value: string | undefined) {
  if (value === "startDate" || value === "amount" || value === "status" || value === "number")
    return value;
  return undefined;
}

function normalizeSortDirection(value: string | undefined) {
  if (value === "asc" || value === "desc") return value;
  return undefined;
}

export default async function ReservationsPage({ searchParams }: ReservationsPageProps) {
  const store = await getCurrentStore();
  if (!store) return null;

  const params = await searchParams;
  const shouldRestorePreferredView = !params.view && params.restorePreferredView === "true";

  // A bare reservations URL starts on the calendar until the client restores
  // the store's preferred view. Home activity links can explicitly request the
  // same restoration with filters, while other list-specific deep links keep
  // opening the list. An explicit view always wins.
  const hasListParams = Boolean(
    params.status ||
    params.period ||
    params.operation ||
    params.paymentMethod ||
    params.search ||
    params.sort ||
    params.sortDirection ||
    params.page ||
    params.pageSize ||
    params.display,
  );
  const view = params.view
    ? parseReservationView(params.view)
    : hasListParams && !shouldRestorePreferredView
      ? "list"
      : "calendar";

  const currency = store.settings?.currency || "EUR";
  const timezone = store.settings?.timezone;

  const status = normalizeStatus(params.status);
  const period = normalizePeriod(params.period);
  const operation = normalizeOperation(params.operation);
  const paymentMethod = normalizePaymentMethod(params.paymentMethod);
  const search = params.search?.trim() || undefined;
  const sort = normalizeSort(params.sort);
  const sortDirection = normalizeSortDirection(params.sortDirection);
  const page = params.page ? parseInt(params.page, 10) : 1;
  const pageSize = params.pageSize ? parseInt(params.pageSize, 10) : 25;

  const initialDataPromise =
    view === "list"
      ? getDashboardReservationsList({
          storeId: store.id,
          status,
          period,
          operation,
          paymentMethod,
          limit: 100,
          search,
          sort,
          sortDirection,
          page,
          pageSize,
        })
      : Promise.resolve(undefined);

  // Fetch the shared catalog with the rest of the page data so switching to
  // calendar or planning never needs another page navigation.
  const [limits, plan, calendarProducts, storeHasReservations, initialData] = await Promise.all([
    getStoreLimits(store.id),
    getStorePlan(store.id),
    getCalendarProducts(store.id),
    getStoreHasReservations(store.id),
    initialDataPromise,
  ]);

  return (
    <Suspense fallback={<ReservationsTableSkeleton />}>
      <PendingDateChangeRequests />
      <ReservationsPageContent
        view={view}
        restorePreferredView={!params.view && (!hasListParams || shouldRestorePreferredView)}
        currentStatus={status}
        currentPeriod={period}
        currentPaymentMethod={paymentMethod}
        initialData={initialData}
        calendarData={{ products: calendarProducts }}
        storeHasReservations={storeHasReservations}
        storeId={store.id}
        limits={limits.reservationsThisMonth}
        planSlug={plan.slug}
        currency={currency}
        timezone={timezone}
      />
    </Suspense>
  );
}
