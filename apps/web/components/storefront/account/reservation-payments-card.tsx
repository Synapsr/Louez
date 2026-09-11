import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { AccountCard } from "@/components/storefront/account/account-card";
import { Price } from "@/components/storefront/ui/price";

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
  /** Money given back: shown negative, labelled as a refund. */
  isRefund: boolean;
}

interface ReservationPaymentsCardProps {
  payments: ReservationPaymentView[];
}

const STATUS_VARIANT: Record<string, "success" | "pending" | "failed" | "tertiary" | "info"> = {
  completed: "success",
  authorized: "info",
  pending: "pending",
  failed: "failed",
  refunded: "tertiary",
  cancelled: "tertiary",
};

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
          const isHold = payment.type === "deposit_hold";
          const typeLabel =
            payment.isRefund && payment.type !== "deposit_return"
              ? t("types.refund")
              : t(`types.${payment.type}`);

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
                <Price amount={payment.isRefund ? -payment.amount : payment.amount} size="sm" />
                <Badge variant={STATUS_VARIANT[payment.status] ?? "tertiary"} size="sm">
                  {t(`${isHold ? "holdStatus" : "status"}.${payment.status}`)}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </AccountCard>
  );
};
