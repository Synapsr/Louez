"use client";

import { useTranslations } from "next-intl";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@louez/ui/components/carousel";
import { ProductCard } from "@/components/storefront/product/product-card";
import { useQuickAdd } from "@/components/storefront/product/quick-add-provider";
import {
  buildProductHref,
  getQuickAddLimit,
} from "@/components/storefront/product/util.product-card";
import { SectionHeader } from "@/components/storefront/ui/section-header";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

import { useCartState } from "@/contexts/cart-context";

interface RelatedProductsProps {
  products: StorefrontCatalogProduct[];
  className?: string;
}

export const RelatedProducts = ({ products, className }: RelatedProductsProps) => {
  const t = useTranslations();
  const { period } = useCartState();
  const quickAdd = useQuickAdd();

  if (products.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="related-products" className={className}>
      <Carousel
        opts={{ align: "start", containScroll: "trimSnaps", slidesToScroll: "auto" }}
        aria-labelledby="related-products"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader
            id="related-products"
            level="h2"
            title={t("storefront.product.relatedProducts")}
            className="mb-0 sm:mb-0"
          />
          <div className="flex shrink-0 gap-2">
            <CarouselPrevious
              aria-label={t("common.previous")}
              className="static size-10 translate-y-0"
            />
            <CarouselNext aria-label={t("common.next")} className="static size-10 translate-y-0" />
          </div>
        </div>
        <CarouselContent className="-ml-4 py-1">
          {products.map((product) => {
            const limit = getQuickAddLimit(product, null);
            return (
              <CarouselItem
                key={product.id}
                className="flex basis-4/5 pl-4 sm:basis-1/2 lg:basis-1/4"
              >
                <ProductCard
                  product={product}
                  href={buildProductHref(product.id, period)}
                  period={period}
                  onQuickAdd={
                    limit !== undefined ? () => quickAdd.start(product, limit, period) : undefined
                  }
                  className="w-full"
                />
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>
    </section>
  );
};
