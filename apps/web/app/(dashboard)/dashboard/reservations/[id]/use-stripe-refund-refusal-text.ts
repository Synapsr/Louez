"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { useStoreTimezone } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { useFormatMoney } from "@/hooks/use-format-money";
import { formatStoreDate } from "@/lib/utils/store-date";

import type { StripeRefundRefusal } from "./util.stripe-refund";

/**
 * A refusal of the refund, its preview or the Stripe link, in the person's words: each
 * code the procedures answer has its own sentence (the amount still refundable, the
 * currency, the refund made a moment ago and by whom), any other code the generic one,
 * without technical detail.
 */
export const useStripeRefundRefusalText = () => {
  const t = useTranslations("dashboard.reservations.payment.stripeRefund");
  const tErrors = useTranslations("errors");
  const formatMoney = useFormatMoney();
  const timezone = useStoreTimezone();
  const { intl: formatLocale } = useFormatLocale();
  return useCallback(
    (refusal: StripeRefundRefusal): string => {
      switch (refusal.key) {
        case "exceedsRefundable":
          return t("errors.exceedsRefundable", {
            amount: formatMoney(Number(refusal.refundable), { currency: refusal.currency }),
          });
        case "currencyNotSupported":
          return t("errors.currencyNotSupported", { currency: refusal.currency });
        case "repeatUnconfirmed": {
          const values = {
            amount: formatMoney(Number(refusal.amount), { currency: refusal.currency }),
            time: formatStoreDate(refusal.refundedAt, timezone, "TIMESTAMP", formatLocale),
          };
          return refusal.by
            ? t("repeat.question", { ...values, name: refusal.by })
            : t("repeat.questionNoName", values);
        }
        case "permission":
          return tErrors("permissionDenied");
        case "demo":
          return tErrors("demoStoreActionDisabled");
        case "stripeNotConfigured":
          return tErrors("stripeNotConfigured");
        case "generic":
          return tErrors("generic");
        default:
          return t(`errors.${refusal.key}`);
      }
    },
    [t, tErrors, formatMoney, timezone, formatLocale],
  );
};
