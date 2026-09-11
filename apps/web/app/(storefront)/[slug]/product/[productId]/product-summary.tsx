"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { isFixedPriceProduct, pricingModeToMinutes, type PricingSegment } from "@louez/utils";

import { CategoryPill } from "@/components/storefront/ui/category-pill";
import { Price } from "@/components/storefront/ui/price";

import type { ProductPageBooking, ProductPageProduct } from "@/lib/storefront/product-page.loader";
import { getSeasonalHeadline } from "@/lib/utils/util.storefront-seasonal-pricing";
import { useStoreTimezone } from "@/contexts/store-context";

import { usePeriodLabel } from "@/hooks/use-period-label";

interface ProductSummaryProps {
  product: ProductPageProduct;
  seasonalSegments?: PricingSegment[];
  rentalPrice?: number;
  /** Length of the selected period, to average a rate across seasons. */
  rentalMinutes?: number;
  booking: Pick<ProductPageBooking, "isAvailable" | "unavailableReason" | "maxQuantity">;
}

/** Category, title, base rate, stock: what a visitor reads first. */
export const ProductSummary = ({
  product,
  booking,
  seasonalSegments,
  rentalPrice,
  rentalMinutes,
}: ProductSummaryProps) => {
  const t = useTranslations("storefront.product");
  const formatPeriodLabel = usePeriodLabel();
  const ts = useTranslations("storefront.seasonalPricing");
  const timezone = useStoreTimezone();
  const headline = getSeasonalHeadline(product, seasonalSegments, rentalPrice, {
    timezone,
    rentalMinutes,
  });
  const isFixed = isFixedPriceProduct(product);
  const per = isFixed
    ? null
    : formatPeriodLabel(
        product.basePeriodMinutes && product.basePeriodMinutes > 0
          ? product.basePeriodMinutes
          : pricingModeToMinutes(product.pricingMode),
      );

  return (
    <div className="flex flex-col gap-3">
      {product.category ? (
        <div>
          <CategoryPill size="sm" href={`/catalog?category=${product.category.id}`}>
            {product.category.name}
          </CategoryPill>
        </div>
      ) : null}
      <h1 className="text-balance text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
        {product.name}
      </h1>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {headline.mode === "from" ? (
          <span className="text-sm text-muted-foreground">{ts("from")}</span>
        ) : null}
        <Price
          amount={headline.amount}
          per={per}
          label={isFixed ? t("fixedPricingLabel") : null}
          size="xl"
        />
      </div>
      {headline.mode === "season" ? (
        <p className="text-sm text-muted-foreground">{headline.seasonName ?? ts("baseSeason")}</p>
      ) : headline.mode === "period" ? (
        <p className="text-sm text-muted-foreground">{ts("averageRate")}</p>
      ) : null}
      {!booking.isAvailable ? (
        <div>
          <Badge variant="failed">
            {t(`unavailableReason.${booking.unavailableReason ?? "unavailable"}`)}
          </Badge>
        </div>
      ) : null}
    </div>
  );
};
