"use client";

import type { ComponentProps } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { ClockIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import type {
  ConnectedAccountPayout,
  ConnectedAccountPayoutStatus,
} from "@/lib/stripe/connected-account-finances";

interface StripePayoutListProps {
  className?: string;
  payouts: ConnectedAccountPayout[];
}

type PayoutBadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const PAYOUT_STATUS_VARIANTS = {
  paid: "success",
  pending: "pending",
  in_transit: "progress",
  failed: "failed",
  canceled: "expired",
  unknown: "tertiary",
} satisfies Record<ConnectedAccountPayoutStatus, PayoutBadgeVariant>;

interface PayoutDateLabel {
  key: "paid" | "expected" | "created";
  date: string;
}

const formatStripeAmount = (amount: number, currency: string, locale: string) => {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  return formatter.format(amount / 10 ** fractionDigits);
};

const formatPayoutDate = (
  status: ConnectedAccountPayoutStatus,
  createdAt: number,
  arrivalAt: number,
  locale: string,
): PayoutDateLabel => {
  const usesArrivalDate = status === "paid" || status === "pending" || status === "in_transit";
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(usesArrivalDate ? arrivalAt : createdAt));

  if (status === "paid") {
    return { key: "paid", date };
  }

  if (status === "pending" || status === "in_transit") {
    return { key: "expected", date };
  }

  return { key: "created", date };
};

export const StripePayoutList = ({ className, payouts }: StripePayoutListProps) => {
  const locale = useLocale();
  const t = useTranslations("dashboard.settings.payments.finances");

  return (
    <ul className={cn("divide-y rounded-xl border", className)}>
      {payouts.map((payout) => {
        const payoutDate = formatPayoutDate(
          payout.status,
          payout.createdAt,
          payout.arrivalAt,
          locale,
        );

        return (
          <li
            key={payout.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold tabular-nums">
                {formatStripeAmount(payout.amount, payout.currency, locale)}
              </p>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <ClockIcon className="size-3.5" />
                  {t(`payoutDates.${payoutDate.key}`, { date: payoutDate.date })}
                </span>
                {payout.destinationLast4 ? (
                  <span>{t("destination", { last4: payout.destinationLast4 })}</span>
                ) : null}
              </div>
            </div>

            <Badge variant={PAYOUT_STATUS_VARIANTS[payout.status]}>
              {t(`statuses.${payout.status}`)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
};
