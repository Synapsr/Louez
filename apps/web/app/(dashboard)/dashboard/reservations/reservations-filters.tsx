"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { useTranslations } from "next-intl";
import { useDebouncedCallback } from "use-debounce";

import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTab,
} from "@louez/ui";

import { SearchInput } from "@/components/ui/search-input";

import type { ReservationCounts } from "./reservations-types";

interface ReservationsFiltersProps {
  counts: ReservationCounts;
  currentStatus?: string;
  currentPeriod?: string;
  currentPaymentMethod?: string;
  /** Rendered at the end of the search/period row (e.g. display-mode toggle) */
  endSlot?: React.ReactNode;
}

const STATUS_KEYS = ["all", "pending", "confirmed", "ongoing", "completed", "cancelled"] as const;
const PERIOD_KEYS = ["all", "today", "thisWeek", "thisMonth", "overdue"] as const;
const PAYMENT_METHOD_KEYS = ["stripe", "cash", "card", "transfer", "check", "other"] as const;

export const ReservationsFilters = ({
  counts,
  currentStatus = "all",
  currentPeriod = "all",
  currentPaymentMethod = "all",
  endSlot,
}: ReservationsFiltersProps) => {
  const t = useTranslations("dashboard.reservations");
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get("search") || "";
  const [searchQuery, setSearchQuery] = useState(currentSearch);
  const pendingSearchParamsRef = useRef(new Set<string>());
  const latestSearchQueryRef = useRef(currentSearch);
  const navigateToSearchRef = useRef<(term: string, mode?: "push" | "replace") => void>(() => {});

  const createQueryString = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      return params.toString();
    },
    [searchParams],
  );

  const navigateToSearch = useCallback(
    (term: string, mode: "push" | "replace" = "push") => {
      if (term === currentSearch) {
        return;
      }

      pendingSearchParamsRef.current.add(term);
      const href = `/dashboard/reservations?${createQueryString({
        search: term || null,
        page: null,
      })}`;

      if (mode === "replace") {
        router.replace(href);
        return;
      }

      router.push(href);
    },
    [createQueryString, currentSearch, router],
  );

  useEffect(() => {
    navigateToSearchRef.current = navigateToSearch;
  }, [navigateToSearch]);

  // Search route updates can land after newer keystrokes. Ignore values pushed
  // by this component so an older URL state cannot overwrite the local input.
  useEffect(() => {
    if (pendingSearchParamsRef.current.delete(currentSearch)) {
      if (currentSearch !== "" && latestSearchQueryRef.current === "") {
        navigateToSearchRef.current("", "replace");
      }
      return;
    }

    latestSearchQueryRef.current = currentSearch;
    setSearchQuery(currentSearch);
  }, [currentSearch]);

  const handleStatusChange = (value: string) => {
    router.push(
      `/dashboard/reservations?${createQueryString({
        status: value === "all" ? null : value,
        operation: null,
        page: null, // reset page when changing filters
      })}`,
    );
  };

  const handlePeriodChange = (value: string | null) => {
    if (value === null) return;
    router.push(
      `/dashboard/reservations?${createQueryString({
        period: value === "all" ? null : value,
        operation: null,
        page: null,
      })}`,
    );
  };

  const handlePaymentMethodChange = (value: string | null) => {
    if (value === null) return;
    router.push(
      `/dashboard/reservations?${createQueryString({
        paymentMethod: value === "all" ? null : value,
        page: null,
      })}`,
    );
  };

  const handleSearch = useDebouncedCallback((term: string) => {
    navigateToSearch(term);
  }, 300);

  const updateSearchQuery = (term: string) => {
    latestSearchQueryRef.current = term;
    setSearchQuery(term);
    handleSearch(term);
  };

  const clearSearchQuery = () => {
    latestSearchQueryRef.current = "";
    setSearchQuery("");
    handleSearch.cancel();
    navigateToSearch("");
  };

  const getCount = (status: string): number => {
    if (status === "all") return counts.all;
    return counts[status as keyof Omit<ReservationCounts, "all">] || 0;
  };

  const getStatusLabel = (key: string): string => {
    if (key === "all") return t("filters.all");
    return t(`status.${key}`);
  };

  const getPeriodLabel = (key: string): string => {
    if (key === "all") return t("allPeriods");
    return t(`filters.${key}`);
  };

  // Map period keys to URL values
  const periodUrlMap: Record<string, string> = {
    all: "all",
    today: "today",
    thisWeek: "week",
    thisMonth: "month",
    overdue: "overdue",
  };

  // Map URL values back to keys for display
  const urlToPeriodMap: Record<string, string> = {
    all: "all",
    today: "today",
    week: "thisWeek",
    month: "thisMonth",
    overdue: "overdue",
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Status filter — underlined tabs, so it reads as "narrow the
          data" next to the segmented view switcher above it */}
      <div className="h-[45px] overflow-x-auto sm:h-[41px]">
        <Tabs
          className="w-max"
          value={currentStatus}
          onValueChange={(value) => handleStatusChange(value as string)}
        >
          <TabsList variant="underline">
            {STATUS_KEYS.map((key) => {
              const count = getCount(key);
              const isActive = currentStatus === key;

              return (
                <TabsTab key={key} value={key}>
                  {getStatusLabel(key)}
                  <Badge
                    variant={
                      key === "pending" && count > 0 ? "pending" : isActive ? "progress" : "expired"
                    }
                    size="sm"
                  >
                    {count}
                  </Badge>
                </TabsTab>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      {/* Row 2: Search + Period */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Search */}
        <div className="relative min-w-0 max-w-sm flex-1">
          <SearchInput
            value={searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
            onClear={clearSearchQuery}
            placeholder={t("searchReservations")}
            clearLabel={t("clearSearch")}
          />
        </div>

        {/* Period Filter */}
        <Select value={currentPeriod} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-full sm:w-45">
            <SelectValue placeholder={t("period")}>
              {getPeriodLabel(urlToPeriodMap[currentPeriod] || "all")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PERIOD_KEYS.map((key) => (
              <SelectItem key={key} value={periodUrlMap[key]} label={getPeriodLabel(key)}>
                {getPeriodLabel(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={currentPaymentMethod} onValueChange={handlePaymentMethodChange}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={t("paymentMethod")}>
              {currentPaymentMethod === "all"
                ? t("allPaymentMethods")
                : t(`payment.methods.${currentPaymentMethod}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" label={t("allPaymentMethods")}>
              {t("allPaymentMethods")}
            </SelectItem>
            {PAYMENT_METHOD_KEYS.map((method) => (
              <SelectItem key={method} value={method} label={t(`payment.methods.${method}`)}>
                {t(`payment.methods.${method}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {endSlot}
      </div>
    </div>
  );
};
