"use client";

import Image from "next/image";

import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingKind } from "@louez/types";
import { isFixedPriceProduct } from "@louez/utils";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { useFormatMoney } from "@/hooks/use-format-money";

export interface AdvisorRecommendedProduct {
  id: string;
  name: string;
  price: string;
  pricingKind?: PricingKind | null;
  pricingMode: "hour" | "day" | "week" | null;
  image: string | null;
}

interface AdvisorProductCardsProps {
  products: AdvisorRecommendedProduct[];
}

/** Renders a recommend_products tool result as tappable product cards. */
export const AdvisorProductCards = ({ products }: AdvisorProductCardsProps) => {
  const t = useTranslations("storefront.product");
  const formatMoney = useFormatMoney();

  if (products.length === 0) return null;

  return (
    <div className="my-2 flex flex-col gap-2">
      {products.map((product) => (
        <StorefrontLink
          key={product.id}
          href={`/product/${product.id}`}
          className="flex min-h-11 items-center gap-3 rounded-lg border bg-background p-2 transition-colors hover:bg-muted"
        >
          <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
            {product.image ? (
              <Image src={product.image} alt="" fill sizes="56px" className="object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center">
                <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatMoney(Number(product.price))}
              {isFixedPriceProduct(product)
                ? ` · ${t("fixedPricingLabel")}`
                : product.pricingMode
                  ? ` / ${t(`pricingUnit.${product.pricingMode}.singular`)}`
                  : null}
            </p>
          </div>
        </StorefrontLink>
      ))}
    </div>
  );
};
