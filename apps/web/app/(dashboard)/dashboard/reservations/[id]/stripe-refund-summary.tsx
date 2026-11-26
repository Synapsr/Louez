"use client";

import { useTranslations } from "next-intl";

import type { PreviewRefundOutput } from "@louez/api/contracts/stripe-refunds";

import { useStoreTimezone } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

import { useReservationMoney } from "./use-reservation-money";
import { cardBrandLabel, paymentTypeKey } from "./util.stripe-refund";

interface StripeRefundSummaryProps {
  preview: PreviewRefundOutput;
  customerName: string;
  /** The amount about to be refunded, once it is valid; null while it is not. */
  amount: string | null;
  /** What stays refundable after this refund, once the amount is valid. */
  remainingAfter: string | null;
}

/**
 * What a person reads before refunding a payment taken online: the facts an agent's
 * approval page shows for the same refund (the amount and where it goes, the payment,
 * what was refunded and stays refundable, Stripe's balance), and what follows from it.
 */
export const StripeRefundSummary = ({
  preview,
  customerName,
  amount,
  remainingAfter,
}: StripeRefundSummaryProps) => {
  const t = useTranslations("dashboard.reservations.payment");
  const timezone = useStoreTimezone();
  const { intl: formatLocale } = useFormatLocale();
  const money = useReservationMoney(preview.currency);
  const shown = amount === null ? "—" : money(amount);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="font-medium">{t("stripeRefund.summary.title")}</p>
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("stripeRefund.summary.amount")}</dt>
          <dd className="font-mono font-medium">{shown}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("stripeRefund.summary.to")}</dt>
          <dd className="text-right">
            {preview.card
              ? t("stripeRefund.summary.card", {
                  brand: cardBrandLabel(preview.card.brand),
                  last4: preview.card.last4,
                })
              : t("stripeRefund.summary.payer")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("stripeRefund.summary.payment")}</dt>
          <dd className="text-right">
            {t("stripeRefund.summary.paymentValue", {
              type: t(`types.${paymentTypeKey(preview.type)}`),
              amount: money(preview.paid),
              date: formatStoreDate(preview.paidAt, timezone, "TIMESTAMP", formatLocale),
            })}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("stripeRefund.summary.reservation")}</dt>
          <dd className="text-right">
            {t("stripeRefund.summary.reservationValue", {
              number: preview.number,
              customer: customerName,
            })}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("stripeRefund.summary.alreadyRefunded")}</dt>
          <dd className="font-mono">{money(preview.refunded)}</dd>
        </div>
        {Number(preview.inFlight) > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("stripeRefund.summary.inFlight")}</dt>
            <dd className="font-mono">{money(preview.inFlight)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("stripeRefund.summary.remainingAfter")}</dt>
          <dd className="font-mono">{remainingAfter === null ? "—" : money(remainingAfter)}</dd>
        </div>
      </dl>
      <ul className="list-disc space-y-1 ps-4 text-muted-foreground">
        <li>{t("stripeRefund.summary.balance")}</li>
        <li>{t("stripeRefund.summary.noMessage")}</li>
        <li>{t("stripeRefund.summary.final")}</li>
        {preview.creditNote && <li>{t("stripeRefund.summary.creditNote")}</li>}
      </ul>
    </div>
  );
};
