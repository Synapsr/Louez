"use client";

import { useLocale, useTranslations } from "next-intl";

import { formatMinor } from "@/lib/billing/billing-format";
import type { BillingBalance as BillingBalanceView } from "@/lib/billing-sync/pages";

/**
 * What the store owes and has not paid, with its limit when staff set one (README
 * §8.8). Louez reads the service's numbers and `standing`, never a limit of its own.
 */
export const BillingBalance = ({ balance }: { balance: BillingBalanceView }) => {
  const t = useTranslations("dashboard.settings.billing.card");
  const locale = useLocale();
  const amount = formatMinor(balance.amountMinor, balance.currency, locale);
  const text =
    balance.limitMinor === null
      ? t("balance", { amount })
      : t("balanceWithLimit", {
          amount,
          limit: formatMinor(balance.limitMinor, balance.currency, locale),
        });
  return (
    <p
      className={
        balance.standing === "ok"
          ? "text-muted-foreground text-sm tabular-nums"
          : "text-sm font-medium tabular-nums"
      }
    >
      {text}
    </p>
  );
};
