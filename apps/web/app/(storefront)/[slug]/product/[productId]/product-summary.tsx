"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { isFixedPriceProduct, pricingModeToMinutes } from "@louez/utils";

import { CategoryPill } from "@/components/storefront/ui/category-pill";
import { Price } from "@/components/storefront/ui/price";

import type { ProductPageBooking, ProductPageProduct } from "@/lib/storefront/product-page.loader";
import { parseStorefrontDecimal } from "@/lib/utils/util.storefront-product-pricing";

import { usePeriodLabel } from "@/hooks/use-period-label";

interface ProductSummaryProps {
  product: ProductPageProduct;
  booking: Pick<ProductPageBooking, "isAvailable" | "unavailableReason" | "maxQuantity">;
}

/** Category, title, base rate, stock: what a visitor reads first. */
export const ProductSummary = ({ product, booking }: ProductSummaryProps) => {
  const t = useTranslations("storefront.product");
  const formatPeriodLabel = usePeriodLabel();
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
        <Price
          amount={parseStorefrontDecimal(product.price) ?? 0}
          per={per}
          label={isFixed ? t("fixedPricingLabel") : null}
          size="xl"
        />
      </div>
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
