"use client";

import Link from "next/link";

import { ArrowDownRight, ArrowUpRight, ChevronRight, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { getOverdueListHref } from "@/lib/dashboard/util.home-links";
import type { OverdueSummary as OverdueSummaryData } from "@/lib/dashboard/util.overdue-summary";

import type { OverdueHomeReservation } from "./home-types";
import { OverdueProductPile } from "./overdue-product-pile";

interface OverdueCompactProps {
  summary: OverdueSummaryData;
  /** The oldest overdue reservations, for the photos of the gear concerned. */
  rows: OverdueHomeReservation[];
  /** Server-side "now", so the relative times match the rendered markup. */
  now: Date;
}

/**
 * What previous days left to settle, in one strip above the agenda, whatever
 * the day being read: how many and since when, how they split — gear not
 * back, hand-overs to confirm, with the agenda's arrows — behind a small pile
 * of photos of the gear concerned. It opens them all in the reservations
 * list, which sorts them better than a home card can.
 */
export const OverdueCompact = ({ summary, rows, now }: OverdueCompactProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  // Gear not back and hand-overs to confirm together: the total, then the split.
  const isMixed = summary.returns.count > 0 && summary.departures.count > 0;
  const isReturns = summary.returns.count > 0;
  // When it was due: "the oldest" only means something among several, and
  // agrees with what it follows (a return, a hand-over, a reservation).
  const dateKey =
    summary.total === 1
      ? isReturns
        ? "overdue.dueReturn"
        : "overdue.dueDeparture"
      : isMixed
        ? "overdue.oldestMixed"
        : isReturns
          ? "overdue.oldestReturn"
          : "overdue.oldestDeparture";

  return (
    <Link
      href={getOverdueListHref()}
      className="group bg-destructive/8 hover:bg-destructive/12 focus-visible:ring-ring flex min-w-0 shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {/* The gear concerned, when known; the alert mark otherwise. */}
      {rows.some((row) => row.items.some((item) => item.product)) ? (
        <OverdueProductPile rows={rows} />
      ) : (
        <span
          aria-hidden
          className="bg-destructive/12 text-badge-failed-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
        >
          <TriangleAlert className="size-4" strokeWidth={2.25} />
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate">
          <span className="text-badge-failed-foreground font-bold">
            {/* One kind only: it names itself, no split line to repeat it. */}
            {isMixed
              ? t("overdue.compact", { count: summary.total })
              : summary.returns.count > 0
                ? t("overdue.groupedNotReturned", { count: summary.returns.count })
                : t("overdue.groupedToConfirm", { count: summary.departures.count })}
          </span>
          {summary.oldestDueAt && (
            <span className="text-muted-foreground">
              {" · "}
              {t(dateKey, { relative: format.relativeTime(summary.oldestDueAt, now) })}
            </span>
          )}
        </span>
        {isMixed && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-semibold">
            <span className="text-foreground/80 inline-flex items-center gap-1">
              <ArrowDownRight className="text-primary size-3" strokeWidth={3} />
              {t("overdue.groupedNotReturned", { count: summary.returns.count })}
            </span>
            <span className="text-foreground/80 inline-flex items-center gap-1">
              <ArrowUpRight className="text-success size-3" strokeWidth={3} />
              {t("overdue.groupedToConfirm", { count: summary.departures.count })}
            </span>
          </span>
        )}
      </span>

      <span className="text-foreground inline-flex shrink-0 items-center gap-0.5 font-semibold">
        <span className="max-sm:sr-only">{t("viewAll")}</span>
        <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
};
