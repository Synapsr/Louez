"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Download } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { PartnerBooking, PartnerStatement } from "@louez/api/contracts/partners";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardPanel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { apiErrorKey } from "@/lib/orpc/errors";
import { partnersMutations, partnersQueries } from "@/lib/queries/partners.queries";

import { PartnerAdjustDialog } from "./partner-adjust-dialog";
import { PartnerBookingRow } from "./partner-booking-row";
import type { usePartnersAnalytics } from "./use-partners-analytics";
import { buildPartnerStatementCsv, partnerStatementFileName } from "./util.partner-csv";

interface PartnerStatementCardProps {
  statement: PartnerStatement;
  months: readonly string[];
  onMonthChange: (month: string) => void;
  analytics: ReturnType<typeof usePartnersAnalytics>;
}

/**
 * A month's statement: what the store owes the partner, what it marked paid,
 * the reservations behind it; marking it paid and exporting it.
 */
export const PartnerStatementCard = ({
  statement,
  months,
  onMonthChange,
  analytics,
}: PartnerStatementCardProps) => {
  const t = useTranslations("dashboard.partners.statement");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [adjusting, setAdjusting] = useState<PartnerBooking | null>(null);
  const { totals, currency, partner } = statement;
  const money = (amount: number) => formatCurrency(amount, currency);

  const monthLabel = (month: string) => {
    const [year, index] = month.split("-").map(Number);
    return format.dateTime(new Date(year, index - 1, 1), { month: "long", year: "numeric" });
  };

  const onError = (error: unknown) => {
    const key = apiErrorKey(error);
    toastManager.add({
      title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
      type: "error",
    });
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: partnersQueries.key() });

  const markPaid = useMutation({
    ...partnersMutations.markMonthPaid(),
    onSuccess: () => {
      analytics.monthPaid(totals.bookings);
      setConfirmPaid(false);
      void refresh();
    },
    onError,
  });
  const cancelPayout = useMutation({
    ...partnersMutations.cancelPayout(),
    onSuccess: () => void refresh(),
    onError,
  });
  const removeBooking = useMutation({
    ...partnersMutations.setForReservation(),
    onSuccess: () => {
      analytics.reservationChanged("removed");
      toastManager.add({ title: t("removed"), type: "success" });
      void refresh();
    },
    onError,
  });

  const exportCsv = () => {
    const csv = buildPartnerStatementCsv(statement, {
      headers: {
        number: t("csv.number"),
        startDate: t("csv.startDate"),
        endDate: t("csv.endDate"),
        base: t("csv.base"),
        rule: t("csv.rule"),
        commission: t("csv.commission"),
        state: t("csv.state"),
        note: t("csv.note"),
      },
      states: {
        upcoming: t("states.upcoming"),
        due: t("states.due"),
        cancelled: t("states.cancelled"),
      },
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = partnerStatementFileName(partner.code, statement.month);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    analytics.statementExported();
  };

  return (
    <Card>
      <CardPanel className="space-y-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <h2 className="font-semibold">{t("title")}</h2>
          <Select
            value={statement.month}
            items={months.map((month) => ({ value: month, label: monthLabel(month) }))}
            onValueChange={(value) => value && onMonthChange(value)}
          >
            <SelectTrigger className="w-44 first-letter:uppercase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((month) => (
                <SelectItem key={month} value={month}>
                  {monthLabel(month)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <dl className="grid grid-cols-3 gap-3 border-b px-4 py-4 sm:px-5">
          <div>
            <dt className="text-muted-foreground text-xs">{t("due")}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money(totals.due)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("paid")}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money(totals.paid)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("remaining")}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money(totals.remaining)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
          <p className="text-muted-foreground text-sm">
            {totals.upcoming > 0 && t("upcoming", { amount: money(totals.upcoming) })}
            {totals.upcoming > 0 && " · "}
            {t("visits", { count: totals.visits })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={statement.bookings.length === 0}
            >
              <Download />
              {t("export")}
            </Button>
            {totals.remaining > 0 && (
              <Button size="sm" onClick={() => setConfirmPaid(true)}>
                <Check />
                {t("markPaid")}
              </Button>
            )}
          </div>
        </div>

        {statement.bookings.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm sm:px-5">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y">
            {statement.bookings.map((booking) => (
              <PartnerBookingRow
                key={booking.reservationId}
                booking={booking}
                currency={currency}
                onAdjust={() => setAdjusting(booking)}
                onRemove={() =>
                  removeBooking.mutate({ reservationId: booking.reservationId, partnerId: null })
                }
              />
            ))}
          </ul>
        )}

        {statement.payouts.length > 0 && (
          <ul className="space-y-1 border-t px-4 py-3 text-sm sm:px-5">
            {statement.payouts.map((payout) => (
              <li key={payout.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("payout", {
                    amount: money(payout.amount),
                    date: format.dateTime(payout.paidAt, { dateStyle: "medium" }),
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancelPayout.isPending}
                  onClick={() => cancelPayout.mutate({ payoutId: payout.id })}
                >
                  {t("cancelPayout")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground border-t px-4 py-3 text-xs sm:px-5">{t("rules")}</p>
      </CardPanel>

      <AlertDialog open={confirmPaid} onOpenChange={setConfirmPaid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("markPaidTitle", {
                amount: money(totals.remaining),
                month: monthLabel(statement.month),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("markPaidDescription", { partner: partner.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button type="button" variant="outline" />}>
              {t("cancel")}
            </AlertDialogClose>
            <Button
              isPending={markPaid.isPending}
              onClick={() => markPaid.mutate({ partnerId: partner.id, month: statement.month })}
            >
              {t("markPaid")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PartnerAdjustDialog
        key={adjusting?.reservationId ?? "none"}
        booking={adjusting}
        currency={currency}
        onClose={() => setAdjusting(null)}
        onAdjusted={(removed) =>
          analytics.reservationChanged(removed ? "adjustment_removed" : "adjusted")
        }
      />
    </Card>
  );
};
