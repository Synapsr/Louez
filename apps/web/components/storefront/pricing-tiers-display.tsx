"use client";

import { useState } from "react";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStoreTimezone } from "@/contexts/store-context";
import { usePricingNow } from "@/hooks/use-pricing-now";
import type { ProductPromotion, PricingKind, PricingMode } from "@louez/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerTrigger,
  DrawerPopup,
  DrawerHeader,
  DrawerTitle,
  DrawerPanel,
} from "@louez/ui";
import { useMediaQuery } from "@/hooks/use-media-query";

import { RateRows } from "@/components/storefront/product/rate-rows";
import type { StorefrontPricingTier } from "@/lib/storefront/storefront.types";
import { getStorefrontRateRows } from "@/lib/utils/util.storefront-pricing";

// Long rate grids are the norm on hourly products; keep the card short and let
// the visitor open the rest.
const MAX_VISIBLE_ROWS = 4;

interface PricingTiersDisplayProps {
  basePrice: number;
  promotion?: ProductPromotion | null;
  pricingKind?: PricingKind | null;
  pricingMode: PricingMode;
  basePeriodMinutes?: number | null;
  tiers: StorefrontPricingTier[];
  className?: string;
}

/** Rates card of the product page: the base rate and what longer rentals cost. */
export const PricingTiersDisplay = ({
  basePrice,
  promotion,
  pricingKind,
  pricingMode,
  basePeriodMinutes,
  tiers,
  className,
}: PricingTiersDisplayProps) => {
  const t = useTranslations("storefront.product.tieredPricing");
  const timezone = useStoreTimezone();
  const now = usePricingNow();
  const [isOpen, setIsOpen] = useState(false);
  const isSidePanel = useMediaQuery("(min-width: 1024px)");

  // A forfait has no rate grid, so this yields no rows and the card is skipped.
  const rateRows = getStorefrontRateRows(
    {
      price: basePrice,
      promotion,
      pricingKind,
      pricingMode,
      basePeriodMinutes,
      pricingTiers: tiers,
    },
    { timezone, now },
  );

  if (rateRows.length <= 1) return null;

  const hiddenCount = rateRows.length - MAX_VISIBLE_ROWS;
  const hasHiddenRows = hiddenCount > 0;
  const visibleRows = hasHiddenRows ? rateRows.slice(0, MAX_VISIBLE_ROWS) : rateRows;

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen} position={isSidePanel ? "right" : "bottom"}>
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg font-semibold leading-snug">{t("ratesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RateRows rows={visibleRows} />
          {hasHiddenRows ? (
            <DrawerTrigger
              render={<Button type="button" variant="ghost" size="sm" className="self-start" />}
            >
              {t("viewAllRates", { count: rateRows.length })}
              <ArrowRight />
            </DrawerTrigger>
          ) : null}
        </CardContent>
      </Card>
      <DrawerPopup variant="inset" showCloseButton className="lg:max-w-md">
        <DrawerHeader>
          <DrawerTitle>{t("ratesTitle")}</DrawerTitle>
        </DrawerHeader>
        <DrawerPanel>
          <RateRows rows={rateRows} />
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
};
