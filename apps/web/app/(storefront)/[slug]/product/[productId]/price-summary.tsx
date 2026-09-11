"use client";

import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@louez/ui";
import type { SeasonalPricingConfig } from "@louez/utils";

import { useTranslations } from "next-intl";

import { Price } from "@/components/storefront/ui/price";
import { BillingDetail } from "@/components/storefront/product/billing-detail";
import { SeasonSwatch } from "@/components/storefront/ui/season-swatch";
import {
  getSeasonToneMap,
  getSeasonalPriceShares,
} from "@/lib/utils/util.storefront-seasonal-pricing";

import type { BookingPrice } from "./use-booking-price";

interface PriceSummaryProps {
  price: BookingPrice;
  /** The product's seasons, so the price split matches the calendar colours. */
  seasons?: SeasonalPricingConfig[];
  /** Rented duration ("3 jours") or "Forfait", shown next to the subtotal. */
  durationLabel: string | null;
}

/**
 * What the cart will show for this selection: subtotal, the discount that
 * applied, each extra, the total — and the deposit on its own line, since
 * it is a hold on the card and never part of the total.
 */
export const PriceSummary = ({ price, seasons, durationLabel }: PriceSummaryProps) => {
  const t = useTranslations("storefront.product");
  const ts = useTranslations("storefront.seasonalPricing");

  if (!price.isPriced) {
    return null;
  }

  // Several seasons split the subtotal: they read as its detail lines rather
  // than as a block of their own, so the card keeps one column of amounts.
  const shares = getSeasonalPriceShares(price.seasonalSegments ?? [], getSeasonToneMap(seasons));

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            {t("subtotal")}
            {durationLabel ? ` · ${durationLabel}` : null}
            <BillingDetail detail={price.billingDetail} className="mt-1" />
          </dt>
          <dd>
            <Price
              amount={price.subtotal}
              compareAt={price.discountPercent !== null ? price.originalSubtotal : null}
              size="sm"
            />
          </dd>
        </div>
        {shares.length > 1
          ? shares.map((share) => (
              <div key={share.id} className="flex items-baseline justify-between gap-4 text-xs">
                <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <SeasonSwatch toneIndex={share.toneIndex} />
                  <span className="truncate">{share.name ?? ts("baseSeason")}</span>
                </dt>
                <dd>
                  <Price amount={share.subtotal} size="sm" className="text-muted-foreground" />
                </dd>
              </div>
            ))
          : null}
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
    </div>
  );
};
