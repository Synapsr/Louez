"use client";

import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, Button } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";

import { useStripeRefundRefusalText } from "./use-stripe-refund-refusal-text";
import type { StripeRefundRefusal } from "./util.stripe-refund";

interface StripeRefundRepeatPromptProps {
  refusal: Extract<StripeRefundRefusal, { key: "repeatUnconfirmed" }>;
  disabled: boolean;
  /** Sends the same refund again, confirmed (`confirmRepeat`). */
  onConfirm: () => void;
}

/**
 * The same amount as a refund made on the payment a moment ago: when, by whom, and a
 * button, the only way to refund that amount again.
 */
export const StripeRefundRepeatPrompt = ({
  refusal,
  disabled,
  onConfirm,
}: StripeRefundRepeatPromptProps) => {
  const t = useTranslations("dashboard.reservations.payment.stripeRefund.repeat");
  const refusalText = useStripeRefundRefusalText();
  const formatMoney = useFormatMoney();

  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertDescription>
        <p>{refusalText(refusal)}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={disabled}
          onClick={onConfirm}
        >
          {t("confirm", {
            amount: formatMoney(Number(refusal.amount), { currency: refusal.currency }),
          })}
        </Button>
      </AlertDescription>
    </Alert>
  );
};
