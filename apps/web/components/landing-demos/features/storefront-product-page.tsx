"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ProductPageContent } from "@/app/(storefront)/[slug]/product/[productId]/product-page-content";
import { BookingPanelView } from "@/app/(storefront)/[slug]/product/[productId]/booking-panel-view";
import { RelatedProductsView } from "@/app/(storefront)/[slug]/product/[productId]/related-products-view";
import { useBookingPrice } from "@/app/(storefront)/[slug]/product/[productId]/use-booking-price";
import { ProductRentalInformation } from "@/components/storefront/product/product-rental-information";
import { StoreHeader } from "@/components/storefront/store-header";
import { HeaderSearchCapsuleView } from "@/components/storefront/shell/header-search-capsule-view";
import { CartTriggerView } from "@/components/storefront/cart/cart-trigger-view";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { DEMO_RULES } from "@/lib/landing-demos/fixtures";
import { getDemoProductPage } from "@/lib/landing-demos/product-page";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";

const demoHref = () => "/demos/landing/storefront-product";

export const StorefrontProductPage = ({
  productId,
  period,
  onPeriodChange,
  cartCount,
  onOpenCart,
  onReserve,
  onQuickAdd,
  onCatalog,
  onOpenProduct,
}: {
  productId: string;
  period: RentalPeriodValue;
  onPeriodChange: (period: RentalPeriodValue) => void;
  cartCount: number;
  onOpenCart: () => void;
  onReserve: (quantity: number) => void;
  onQuickAdd: (id: string) => void;
  onCatalog: () => void;
  onOpenProduct: (productId: string) => void;
}) => {
  const t = useTranslations("storefront.product");
  const locale = useDemoLocale();
  const { product, booking, store, relatedProducts } = getDemoProductPage(locale, productId);
  const [quantity, setQuantity] = useState(1);
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [query, setQuery] = useState("");
  const price = useBookingPrice({ product, period, quantity, extras: [] });
  const cartPeriod = { startDate: period.start.toISOString(), endDate: period.end.toISOString() };

  return (
    <div
      data-demo-target="product-page"
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          event.preventDefault();
          const linkedProduct = event.target
            .closest("[data-product-id]")
            ?.getAttribute("data-product-id");
          if (linkedProduct) onOpenProduct(linkedProduct);
          else onCatalog();
        }
      }}
    >
      <StoreHeader
        storeName={store.name}
        homeHref={demoHref()}
        accountPrefetch={false}
        periodRules={DEMO_RULES}
        searchControl={
          <HeaderSearchCapsuleView
            rules={DEMO_RULES}
            className="w-full"
            query={query}
            period={period}
            onQueryChange={setQuery}
            onClear={() => setQuery("")}
            onSubmit={onCatalog}
            onPeriodChange={onPeriodChange}
          />
        }
        cartControl={<CartTriggerView count={cartCount} open={onOpenCart} />}
      />
      <ProductPageContent
        product={product}
        catalogHref={demoHref()}
        getNavigationHref={demoHref}
        allowLightbox={false}
        bookingColumn={
          <BookingPanelView
            product={product}
            booking={booking}
            information={<ProductRentalInformation store={store} />}
            period={period}
            periodRules={DEMO_RULES}
            isPeriodOpen={isPeriodOpen}
            setIsPeriodOpen={setIsPeriodOpen}
            setPeriodOverride={onPeriodChange}
            quantity={quantity}
            maxQuantity={booking.maxQuantity}
            setRequestedQuantity={setQuantity}
            attributeValues={{}}
            selectedAttributes={{}}
            setSelectedAttributes={() => {}}
            requiredAccessories={[]}
            extraIds={new Set()}
            cartProductIds={new Set()}
            price={price}
            ctaLabel={t("addToCart")}
            handleReserve={() => onReserve(quantity)}
            getCategoryHref={demoHref}
          />
        }
        relatedProducts={
          <RelatedProductsView
            products={relatedProducts}
            period={cartPeriod}
            className="min-w-0 border-t pt-8 sm:pt-10"
            getProductHref={demoHref}
            onQuickAdd={(product) => onQuickAdd(product.id)}
          />
        }
      />
    </div>
  );
};
