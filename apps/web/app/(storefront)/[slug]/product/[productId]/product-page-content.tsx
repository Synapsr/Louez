"use client";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { SeasonalRatesDisplay } from "@/components/storefront/product/seasonal-rates-display";
import { PricingTiersDisplay } from "@/components/storefront/pricing-tiers-display";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import type { ProductPageProduct } from "@/lib/storefront/product-page.loader";
import { ProductBreadcrumb } from "./product-breadcrumb";
import { ProductDescription } from "./product-description";
import { ProductGallery } from "./product-gallery";

/** The product page layout, shared with local previews. */
export const ProductPageContent = ({
  product,
  bookingColumn,
  relatedProducts,
  catalogHref = "/catalog",
  getNavigationHref,
  allowLightbox = true,
}: {
  product: ProductPageProduct;
  bookingColumn: ReactNode;
  relatedProducts: ReactNode;
  catalogHref?: string;
  getNavigationHref?: (href: string) => string;
  allowLightbox?: boolean;
}) => {
  const t = useTranslations("storefront.product");
  return (
    <StorefrontSection spacing="tight" contentClassName="flex flex-col gap-6 sm:gap-8">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="tertiary"
          size="icon-sm"
          aria-label={t("backToCatalog")}
          render={<StorefrontLink href={catalogHref} />}
        >
          <ArrowLeftIcon />
        </Button>
        <ProductBreadcrumb
          getHref={getNavigationHref}
          productName={product.name}
          category={product.category}
          className="flex-1"
        />
      </div>

      <div className="grid min-w-0 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-12">
        <ProductGallery
          allowLightbox={allowLightbox}
          images={product.images}
          videoUrl={product.videoUrl}
          productName={product.name}
          className="lg:col-start-1 lg:row-start-1"
        />

        {bookingColumn}

        <div className="flex flex-col gap-6 sm:gap-8 lg:col-start-1 lg:row-start-2">
          <ProductDescription html={product.description} />
          {product.seasonalPricings.length > 0 ? (
            <SeasonalRatesDisplay product={product} />
          ) : product.pricingTiers.length > 0 ? (
            <PricingTiersDisplay
              basePrice={parseFloat(product.price)}
              promotion={product.promotion}
              pricingKind={product.pricingKind}
              pricingMode={product.pricingMode}
              basePeriodMinutes={product.basePeriodMinutes}
              tiers={product.pricingTiers.map((tier) => ({
                id: tier.id,
                minDuration: tier.minDuration,
                discountPercent: tier.discountPercent,
                period: tier.period,
                price: typeof tier.price === "number" ? String(tier.price) : (tier.price ?? null),
                displayOrder: tier.displayOrder ?? null,
              }))}
            />
          ) : null}
        </div>
      </div>
      {relatedProducts}
    </StorefrontSection>
  );
};
