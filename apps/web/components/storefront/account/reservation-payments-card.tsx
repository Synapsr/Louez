import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { AccountCard } from "@/components/storefront/account/account-card";
import { Price } from "@/components/storefront/ui/price";
import type { PaymentRowReading, RefundState } from "@/lib/reservations/util.payment-status";

import { customerPaymentBadge } from "./util.payment-badge";

export interface ReservationPaymentView {
  id: string;
  type: string;
  method: string;
  status: string;
  amount: number;
  /** Formatted in the store timezone. */
  dateLabel: string;
  /** A reason the store wrote for the customer (deposit capture, damage). */
  note?: string | null;
  /**
   * What the row is (`readPaymentRow`): a refund is shown negative, labelled as a refund,
   * with its own state. A failed refund is not listed (`getCustomerPaymentRows`).
   */
  reading: PaymentRowReading;
  /** On a payment refunded in full: what its refunds read (`refundedPaymentState`). */
  refunded?: Exclude<RefundState, "failed"> | null;
}

interface ReservationPaymentsCardProps {
  payments: ReservationPaymentView[];
}

/**
 * Payment history: type, method and date on the left, amount and state on
 * the right. A card hold is never "paid": its states read blocked, released
 * or taken.
 */
export const ReservationPaymentsCard = ({ payments }: ReservationPaymentsCardProps) => {
  const t = useTranslations("storefront.account.paymentHistory");

  if (payments.length === 0) return null;

  return (
    <AccountCard title={t("title")}>
      <ul className="flex flex-col divide-y">
        {payments.map((payment) => {
          const isRefund = payment.reading.kind === "refund";
          const typeLabel =
            isRefund && payment.type !== "deposit_return"
              ? t("types.refund")
              : t(`types.${payment.type}`);
          const badge = customerPaymentBadge(payment.reading, payment.status, payment.refunded);

          return (
            <li
              key={payment.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{typeLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`methods.${payment.method}`)}
                  <span aria-hidden> · </span>
                  {payment.dateLabel}
                </p>
                {payment.note ? (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {payment.note}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Price amount={isRefund ? -payment.amount : payment.amount} size="sm" />
                <Badge variant={badge.variant} size="sm">
                  {t(badge.key)}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </AccountCard>
  );
};
