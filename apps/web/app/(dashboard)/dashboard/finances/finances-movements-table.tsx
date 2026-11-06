"use client";

import { Fragment } from "react";

import Link from "next/link";

import { useLocale, useTranslations } from "next-intl";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import { formatStoreDate } from "@/lib/utils/store-date";
import { dayToDate } from "@/lib/utils/util.day-range";

import { NATURE_LABEL_KEYS } from "./finances.constants";
import { FinancesMovementAmount } from "./finances-movement-amount";
import { FinancesMovementStatusBadge } from "./finances-movement-status-badge";
import type { FinanceMovementDay } from "./util.finances";

interface FinancesMovementsTableProps {
  days: FinanceMovementDay[];
  onSelect: (movementId: string) => void;
}

/** Five columns, grouped by day under a header carrying the day's net: how a till is re-read. */
export const FinancesMovementsTable = ({ days, onSelect }: FinancesMovementsTableProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { timezone } = useStore();

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">{t("table.time")}</TableHead>
            <TableHead>{t("table.customer")}</TableHead>
            <TableHead>{t("table.nature")}</TableHead>
            <TableHead>{t("table.method")}</TableHead>
            <TableHead className="text-right">{t("table.amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((day) => (
            <Fragment key={day.key}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell
                  colSpan={4}
                  className="py-2 text-sm font-semibold first-letter:uppercase"
                >
                  {/* A day key is a store day already: no timezone shift to apply. */}
                  {formatStoreDate(dayToDate(day.key), undefined, "EEE d MMM yyyy", locale)}
                </TableCell>
                <TableCell className="py-2 text-right text-sm font-semibold">
                  <span className="sr-only">{t("table.dayNet")} </span>
                  <FinancesMovementAmount amount={day.net} />
                </TableCell>
              </TableRow>
              {day.movements.map((movement) => (
                <TableRow
                  key={movement.id}
                  className="cursor-pointer"
                  onClick={() => onSelect(movement.id)}
                >
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatStoreDate(movement.date, timezone, "TIME_ONLY", locale)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {movement.customerName || t("table.unknownCustomer")}
                      </span>
                      <Link
                        href={`/dashboard/reservations/${movement.reservationId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-2 hover:underline"
                      >
                        #{movement.reservationNumber}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The keyboard path to the detail sheet; the row click is the pointer's. */}
                      <button
                        type="button"
                        aria-label={t("table.openDetails")}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(movement.id);
                        }}
                        className="focus-visible:ring-ring rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {t(`nature.${NATURE_LABEL_KEYS[movement.nature]}`)}
                      </button>
                      <FinancesMovementStatusBadge status={movement.status} />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t(`methods.${movement.method}`)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <FinancesMovementAmount amount={movement.amount} counted={movement.counted} />
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
