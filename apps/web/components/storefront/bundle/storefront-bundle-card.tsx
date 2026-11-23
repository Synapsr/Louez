"use client";

import { Package, Plus } from "lucide-react";

import { Badge, Button } from "@louez/ui";
import { isFixedPriceProduct, pricingModeToMinutes } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { Price } from "@/components/storefront/ui/price";
import { usePeriodLabel } from "@/hooks/use-period-label";
import type { StorefrontProductBundle } from "@/lib/storefront/bundles.queries";
import { parseStorefrontDecimal } from "@/lib/utils/util.storefront-product-pricing";

interface StorefrontBundleCardProps {
  bundle: StorefrontProductBundle;
  onSelectBundle: (bundle: StorefrontProductBundle) => void;
}

export const StorefrontBundleCard = ({ bundle, onSelectBundle }: StorefrontBundleCardProps) => {
  const formatPeriodLabel = usePeriodLabel();
  const totalUnits = bundle.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article className="flex flex-col justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-card transition-shadow hover:ring-1 hover:ring-foreground/15 sm:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="progress" className="gap-1">
                <Package className="size-3" />
                Gotowy zestaw
              </Badge>
              <span className="text-muted-foreground text-xs">
                {bundle.items.length}{" "}
                {bundle.items.length === 1
                  ? "produkt"
                  : bundle.items.length < 5
                    ? "produkty"
                    : "produktów"}{" "}
                ({totalUnits} szt.)
              </span>
            </div>
            <h3 className="text-base font-semibold text-foreground sm:text-lg">{bundle.name}</h3>
          </div>
        </div>

        {bundle.description ? (
          <p className="text-muted-foreground text-xs leading-relaxed sm:text-sm">
            {bundle.description}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/25 p-2.5">
          {bundle.items.map((item) => {
            const unitPrice = parseStorefrontDecimal(item.product.price) ?? 0;
            const isFixed = isFixedPriceProduct(item.product);
            const per = isFixed
              ? undefined
              : formatPeriodLabel(
                  item.product.basePeriodMinutes && item.product.basePeriodMinutes > 0
                    ? item.product.basePeriodMinutes
                    : pricingModeToMinutes(item.product.pricingMode ?? "day"),
                );

            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2.5 rounded-lg bg-background/80 px-2.5 py-1.5 text-xs sm:text-sm"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <ProductImage
                    src={item.product.images?.[0] ?? null}
                    alt={item.product.name}
                    sizes="36px"
                    containerClassName="size-9 shrink-0 rounded-md"
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Badge variant="tertiary" className="shrink-0 font-semibold">
                      {item.quantity}×
                    </Badge>
                    <span className="truncate font-medium">{item.product.name}</span>
                  </div>
                </div>
                {unitPrice > 0 ? (
                  <div className="shrink-0">
                    <Price amount={unitPrice * item.quantity} size="sm" per={per} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <Button
        type="button"
        onClick={() => onSelectBundle(bundle)}
        className="w-full gap-1.5"
      >
        <Plus className="size-4" />
        Wybierz zestaw do rezerwacji
      </Button>
    </article>
  );
};
