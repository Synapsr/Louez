"use client";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { AccountCard } from "@/components/storefront/account/account-card";
import { useFormatMoney } from "@/hooks/use-format-money";
import type {
  ReservationUpdate,
  ReservationUpdatePaymentType,
} from "@/lib/reservations/util.reservation-updates";

/** One dated line of the customer history, labels already formatted. */
export interface ReservationUpdateView {
  id: string;
  kind: ReservationUpdate["kind"];
  dateLabel: string;
  amount?: number | null;
  paymentType?: ReservationUpdatePaymentType;
  byCustomer?: boolean;
  /** A reason or description written by the store for the customer. */
  note?: string | null;
  /** New rental period, when a modification or extension changed it. */
  periodLabel?: string | null;
}

interface ReservationUpdatesCardProps {
  updates: ReservationUpdateView[];
}

type Tone = "neutral" | "success" | "warning" | "failed";

const TONE: Partial<Record<ReservationUpdate["kind"], Tone>> = {
  confirmed: "success",
  picked_up: "success",
  returned: "success",
  quote_accepted: "success",
  payment_received: "success",
  payment_added: "success",
  deposit_authorized: "success",
  deposit_released: "success",
  extension_confirmed: "success",
  refunded: "success",
  rejected: "failed",
  cancelled: "failed",
  quote_declined: "failed",
  payment_failed: "failed",
  deposit_failed: "failed",
  deposit_captured: "warning",
  inspection_damage_detected: "warning",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  success: "bg-success",
  warning: "bg-warning",
  failed: "bg-destructive",
};

/** Dated events of the reservation, newest first, in the customer's words. */
export const ReservationUpdatesCard = ({ updates }: ReservationUpdatesCardProps) => {
  const t = useTranslations("storefront.account.updates");
  const formatMoney = useFormatMoney();

  if (updates.length === 0) return null;

  const label = (update: ReservationUpdateView): string => {
    const amount =
      update.amount === null || update.amount === undefined ? null : formatMoney(update.amount);
    switch (update.kind) {
      case "payment_added":
        return t(`payment_added_${update.paymentType ?? "rental"}`, { amount: amount ?? "" });
      case "cancelled":
        return t(update.byCustomer ? "cancelled_by_you" : "cancelled");
      case "payment_received":
      case "deposit_authorized":
      case "deposit_captured":
      case "refunded":
        return amount ? t(`${update.kind}_amount`, { amount }) : t(update.kind);
      default:
        return t(update.kind);
    }
  };

  return (
    <AccountCard title={t("title")}>
      <ol className="flex flex-col divide-y">
        {updates.map((update) => {
          const tone = TONE[update.kind] ?? "neutral";
          return (
            <li key={update.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span
                aria-hidden
                className={cn("mt-2 size-2 shrink-0 rounded-full", DOT_CLASS[tone])}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm font-medium leading-5">{label(update)}</p>
                  <time className="text-xs text-muted-foreground">{update.dateLabel}</time>
                </div>
                {update.periodLabel ? (
                  <p className="text-sm text-muted-foreground">
                    {t("newPeriod", { period: update.periodLabel })}
                  </p>
                ) : null}
                {update.note ? (
                  <p className="whitespace-pre-line text-sm text-muted-foreground">{update.note}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </AccountCard>
  );
};
