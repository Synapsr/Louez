"use client";

import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@louez/ui";

import { useTranslations } from "next-intl";

import { Price } from "@/components/storefront/ui/price";

import type { BookingPrice } from "./use-booking-price";

interface PriceSummaryProps {
  price: BookingPrice;
  /** Rented duration ("3 jours") or "Forfait", shown next to the subtotal. */
  durationLabel: string | null;
}

/**
 * What the cart will show for this selection: subtotal, the discount that
 * applied, each extra, the total — and the deposit on its own line, since
 * it is a hold on the card and never part of the total.
 */
export const PriceSummary = ({ price, durationLabel }: PriceSummaryProps) => {
  const t = useTranslations("storefront.product");

  if (!price.isPriced) {
    return null;
  }

  return (
    <dl className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">
          {t("subtotal")}
          {durationLabel ? ` · ${durationLabel}` : null}
        </dt>
        <dd>
          <Price
            amount={price.subtotal}
            compareAt={price.discountPercent !== null ? price.originalSubtotal : null}
            size="sm"
          />
        </dd>
      </div>
      {price.discountPercent !== null ? (
        <div className="flex items-baseline justify-between gap-4 text-success">
          <dt>{t("tieredPricing.discountApplied", { percent: price.discountPercent })}</dt>
          <dd className="inline-flex items-baseline gap-0.5 tabular-nums">
            −
            <Price
              amount={price.originalSubtotal - price.subtotal}
              size="sm"
              className="text-success"
            />
          </dd>
        </div>
      ) : null}
      {price.extras.map((extra) => (
        <div key={extra.id} className="flex items-baseline justify-between gap-4">
          <dt className="min-w-0 truncate text-muted-foreground">
            {extra.name}
            {extra.quantity > 1 ? ` ×${extra.quantity}` : null}
          </dt>
          <dd>
            <Price amount={extra.amount} size="sm" />
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t pt-2">
        <dt className="text-base font-medium">{t("total")}</dt>
        <dd>
          <Price amount={price.total} size="lg" tone="primary" />
        </dd>
      </div>
      {price.deposit > 0 ? (
        <div className="flex items-baseline justify-between gap-4">
          <dt className="inline-flex items-center gap-1 text-muted-foreground">
            {t("booking.depositHold")}
            <Tooltip>
              <TooltipTrigger
                aria-label={t("booking.depositHold")}
                className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CircleHelp aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup className="max-w-64">{t("booking.depositNotCharged")}</TooltipPopup>
            </Tooltip>
          </dt>
          <dd>
            <Price amount={price.deposit} size="sm" className="text-muted-foreground" />
          </dd>
        </div>
      ) : null}
    </dl>
  );
};
