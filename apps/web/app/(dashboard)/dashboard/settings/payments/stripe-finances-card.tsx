"use client";

import { useLocale, useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@louez/ui";
import { WalletIcon, WarningIcon } from "@louez/ui/icons";

import type { ConnectedAccountFinances } from "@/lib/stripe/connected-account-finances";

import { StripePayoutList } from "./stripe-payout-list";
import { StripePayoutsDrawer } from "./stripe-payouts-drawer";

interface StripeFinancesCardProps {
  defaultCurrency: string;
  finances: ConnectedAccountFinances | null;
}

const formatStripeAmount = (amount: number, currency: string, locale: string) => {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  return formatter.format(amount / 10 ** fractionDigits);
};

export const StripeFinancesCard = ({ defaultCurrency, finances }: StripeFinancesCardProps) => {
  const locale = useLocale();
  const t = useTranslations("dashboard.settings.payments.finances");

  const balances = finances?.balances.length
    ? finances.balances
    : [{ currency: defaultCurrency, availableAmount: 0, pendingAmount: 0 }];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WalletIcon className="size-5 shrink-0" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {!finances ? (
          <Alert variant="warning">
            <WarningIcon />
            <AlertDescription>{t("unavailable")}</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/32 p-4">
                <p className="text-muted-foreground text-sm font-medium">{t("available")}</p>
                <div className="mt-1 space-y-1">
                  {balances.map((balance) => (
                    <p
                      key={`available-${balance.currency}`}
                      className="text-2xl font-semibold tracking-tight tabular-nums"
                    >
                      {formatStripeAmount(balance.availableAmount, balance.currency, locale)}
                    </p>
                  ))}
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{t("availableHelp")}</p>
              </div>

              <div className="rounded-xl border bg-muted/32 p-4">
                <p className="text-muted-foreground text-sm font-medium">{t("pending")}</p>
                <div className="mt-1 space-y-1">
                  {balances.map((balance) => (
                    <p
                      key={`pending-${balance.currency}`}
                      className="text-2xl font-semibold tracking-tight tabular-nums"
                    >
                      {formatStripeAmount(balance.pendingAmount, balance.currency, locale)}
                    </p>
                  ))}
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{t("pendingHelp")}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{t("payoutsTitle")}</h3>
                  <p className="text-muted-foreground text-sm">{t("payoutsDescription")}</p>
                </div>
                {finances.payoutsNextCursor ? (
                  <StripePayoutsDrawer
                    initialPage={{
                      items: finances.payouts,
                      nextCursor: finances.payoutsNextCursor,
                    }}
                  />
                ) : null}
              </div>

              {finances.payouts.length === 0 ? (
                <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
                  {t("noPayouts")}
                </div>
              ) : (
                <StripePayoutList payouts={finances.payouts} />
              )}

              <p className="text-muted-foreground text-xs">{t("paidHelp")}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
