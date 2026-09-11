"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@louez/ui";

import type { StorefrontProductPricing } from "@/lib/storefront/storefront.types";
import { getStorefrontSeasonalRates } from "@/lib/utils/util.storefront-seasonal-pricing";

import { SeasonalRateRow } from "./seasonal-rate-row";

export const SeasonalRatesDisplay = ({ product }: { product: StorefrontProductPricing }) => {
  const t = useTranslations("storefront.seasonalPricing");
  const rates = getStorefrontSeasonalRates(product);
  if (rates.length === 0) return null;

  return (
    <Card data-seasonal-rates>
      <CardHeader>
        <CardTitle className="text-lg font-semibold leading-snug">{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/60">
          {rates.map((rate) => (
            <SeasonalRateRow key={rate.id} rate={rate} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
