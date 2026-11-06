"use client";

import Link from "next/link";

import { CircleCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@louez/ui";
import { FINANCE_PAGE_SIZES, type FinanceOutstandingOutput } from "@louez/validations";

import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { useStore } from "@/contexts/store-context";
import { useFormatMoney } from "@/hooks/use-format-money";
import { formatStoreDateRange } from "@/lib/utils/store-date";

import { useFinancesSearchState } from "./use-finances-search-state";
import { getOutstandingAge, type OutstandingAge } from "./util.finances";

interface FinancesOutstandingTabProps {
  data: FinanceOutstandingOutput | undefined;
  isError: boolean;
  /** Frozen at render on the server and the client alike, so ages never flicker on hydration. */
  now: Date;
}

const STATUS_LABEL_KEYS = {
  confirmed: "statusConfirmed",
  ongoing: "statusOngoing",
  completed: "statusCompleted",
} as const;

/** Who owes money: reservations with a balance, the oldest first — not payment rows. */
export const FinancesOutstandingTab = ({ data, isError, now }: FinancesOutstandingTabProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { timezone } = useStore();
  const formatMoney = useFormatMoney();
  const { setState } = useFinancesSearchState();

  const formatAge = (age: OutstandingAge) => {
    if (age.kind === "upcoming") return t("outstanding.ageUpcoming");
    return age.kind === "today"
      ? t("outstanding.ageToday")
      : t("outstanding.ageDays", { count: age.count });
  };

  if (isError) return <p className="text-muted-foreground text-sm">{t("loadError")}</p>;

  if (!data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (data.reservations.length === 0) {
    return (
      <div className="rounded-lg border">
        <EmptyState
          icon={CircleCheck}
          title={t("outstanding.emptyTitle")}
          description={t("outstanding.emptyDescription")}
        />
      </div>
    );
  }

  const rows = data.reservations.map((reservation) => {
    const age = getOutstandingAge(reservation.startDate, now, timezone);
    return {
      ...reservation,
      href: `/dashboard/reservations/${reservation.id}`,
      ageLabel: formatAge(age),
      isOverdue: age.kind === "days",
      dates: formatStoreDateRange(reservation.startDate, reservation.endDate, timezone, locale, {
        compact: true,
      }),
    };
  });

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">
          {t("outstanding.summary", { count: data.totalCount, amount: formatMoney(data.total) })}
        </span>{" "}
        — {t("outstanding.hint")}
      </p>

      <div className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={row.href}
            className="bg-card shadow-card hover:bg-muted/60 focus-visible:ring-ring block space-y-2 rounded-2xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {row.customerName || t("table.unknownCustomer")}
                </span>
                <span className="text-muted-foreground block text-xs">
                  #{row.number} · {row.dates}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatMoney(row.remaining)}
              </span>
            </span>
            <span className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
              <span className="tabular-nums">
                {t("outstanding.paid")} {formatMoney(row.paid)} / {formatMoney(row.total)}
              </span>
              <Badge variant={row.isOverdue ? "warning" : "expired"} size="sm">
                {row.ageLabel}
              </Badge>
            </span>
          </Link>
        ))}
      </div>

      <div className="hidden rounded-lg border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("outstanding.customer")}</TableHead>
              <TableHead>{t("outstanding.reservation")}</TableHead>
              <TableHead>{t("outstanding.dates")}</TableHead>
              <TableHead className="text-right">{t("outstanding.total")}</TableHead>
              <TableHead className="text-right">{t("outstanding.paid")}</TableHead>
              <TableHead className="text-right">{t("outstanding.remaining")}</TableHead>
              <TableHead className="text-right">{t("outstanding.age")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="relative">
                <TableCell className="font-medium">
                  {/* The link stretches over the row: one target, still a real link. */}
                  <Link
                    href={row.href}
                    className="focus-visible:ring-ring rounded-sm after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {row.customerName || t("table.unknownCustomer")}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">#{row.number}</span>
                    <Badge variant="outline" size="sm">
                      {t(`outstanding.${STATUS_LABEL_KEYS[row.status]}`)}
                    </Badge>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.dates}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.total)}</TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {formatMoney(row.paid)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(row.remaining)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={row.isOverdue ? "warning" : "expired"} size="sm">
                    {row.ageLabel}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        totalCount={data.totalCount}
        pageSizes={FINANCE_PAGE_SIZES}
        onPageChange={(page) => void setState({ page: page > 1 ? page : null })}
        onPageSizeChange={(pageSize) =>
          void setState({
            pageSize: FINANCE_PAGE_SIZES.find((size) => size === pageSize) ?? null,
            page: null,
          })
        }
      />
    </div>
  );
};
