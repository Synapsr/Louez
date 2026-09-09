"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";

import type { BusinessHours } from "@louez/types";
import { cn } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";
import {
  formatStoreClockTime,
  formatStoreWeekday,
  getStoreStatus,
  type StoreStatus,
} from "@/lib/utils/util.store-status";

/** The clock only needs to move once a minute. */
const REFRESH_INTERVAL_MS = 60_000;

interface StoreStatusBadgeProps {
  businessHours?: BusinessHours;
  timezone?: string;
  /** Computed on the server for the first render; `null` when hours are not configured. */
  initialStatus: StoreStatus | null;
  className?: string;
}

const describeStatus = (
  status: StoreStatus,
  t: ReturnType<typeof useTranslations<"storefront.status">>,
  locale: string,
  timezone?: string,
): string => {
  if (status.isOpen) {
    return status.closesAt
      ? t("openUntil", { time: formatStoreClockTime(status.closesAt, locale) })
      : t("open");
  }

  const next = status.nextOpening;
  if (!next) return t("closed");

  const time = formatStoreClockTime(next.time, locale);
  if (next.dayOffset === 0) return t("closedOpensAt", { time });
  if (next.dayOffset === 1) return t("closedOpensTomorrow", { time });

  return t("closedOpensOn", { day: formatStoreWeekday(next.dayIso, locale, timezone), time });
};

/**
 * "Ouvert · jusqu'à 18:00" / "Fermé · ouvre demain à 09:00". The server
 * computes the first state; the client keeps it current every minute.
 */
export const StoreStatusBadge = ({
  businessHours,
  timezone,
  initialStatus,
  className,
}: StoreStatusBadgeProps) => {
  const t = useTranslations("storefront.status");
  const { intl: locale } = useFormatLocale();
  const [status, setStatus] = useState<StoreStatus | null>(initialStatus);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getStoreStatus(businessHours, timezone));
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [businessHours, timezone]);

  if (!status) return null;

  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium",
        status.isOpen ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive",
        className,
      )}
      data-slot="store-status-badge"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status.isOpen ? "bg-success motion-safe:animate-pulse" : "bg-destructive",
        )}
      />
      {describeStatus(status, t, locale, timezone)}
    </span>
  );
};
