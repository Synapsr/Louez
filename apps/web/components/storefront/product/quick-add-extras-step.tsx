"use client";

import { useMemo, useState } from "react";

import { useTranslations } from "next-intl";

import { Button, DialogClose, DialogFooter, DialogPanel } from "@louez/ui";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@louez/ui/components/carousel";
import { cn } from "@louez/utils";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { selectRequiredAccessories } from "@/lib/utils/cart-required-accessories";
import { toCartLineInput } from "@/lib/utils/util.cart-line-input";

import { useCartActions, useCartState } from "@/contexts/cart-context";

import { ExtrasList } from "./extras-list";
import { ProductCard } from "./product-card";
import { type ProductCardPeriod, selectOfferableExtras } from "./util.product-card";

interface QuickAddExtrasStepProps {
  /** The product just added. */
  product: StorefrontCatalogProduct;
  period: ProductCardPeriod | null;
  quantity?: number;
  /** Extras added or not, the visitor is done here. */
  onDone: () => void;
}

/**
 * The accessories that go with a product just added: the required ones
 * the cart already carries, listed as such, and the optional ones offered
 * as the same product cards, side by side.
 */
export const QuickAddExtrasStep = ({
  product,
  period,
  quantity = 1,
  onDone,
}: QuickAddExtrasStepProps) => {
  const t = useTranslations("storefront.accessories");
  const { addItem } = useCartActions();
  const { items, period: cartPeriod } = useCartState();
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  // The product itself is in the cart by now: its own line must not hide
  // its accessories, only accessories already added do.
  const cartProductIds = useMemo(
    () =>
      new Set(items.map((item) => item.productId).filter((productId) => productId !== product.id)),
    [items, product.id],
  );
  const extras = selectOfferableExtras(product.accessories, cartProductIds);
  const required = selectRequiredAccessories(product.accessories ?? []);

  const addExtras = () => {
    const startDate = period?.startDate ?? cartPeriod?.startDate;
    const endDate = period?.endDate ?? cartPeriod?.endDate;

    if (startDate && endDate) {
      for (const extra of extras) {
        if (!selectedIds.has(extra.id)) continue;
        addItem(
          toCartLineInput(extra, {
            quantity: 1,
            maxQuantity: extra.quantity,
            requiredAccessories: [],
          }),
          { startDate, endDate },
        );
      }
    }

    onDone();
  };

  const toggle = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <DialogPanel className="flex flex-col gap-4">
        {required.length > 0 ? (
          <div className="flex flex-col gap-2">
            <ExtrasList
              accessories={required}
              cartProductIds={cartProductIds}
              onToggle={toggle}
              quantity={quantity}
              selectedIds={selectedIds}
            />
            <p className="text-muted-foreground text-xs">{t("requiredIncluded")}</p>
          </div>
        ) : null}

        {extras.length > 0 ? (
          <Carousel opts={{ align: "start", containScroll: "trimSnaps" }}>
            <CarouselContent className="-ml-3">
              {extras.map((extra) => (
                <CarouselItem key={extra.id} className="basis-1/2 pl-3 sm:basis-1/3">
                  <ProductCard
                    period={period}
                    product={extra}
                    selection={{
                      selected: selectedIds.has(extra.id),
                      onToggle: () => toggle(extra.id),
                    }}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            {/* Inside the viewport, and gone entirely when there is nothing to scroll. */}
            <CarouselPrevious className="left-2 disabled:hidden" />
            <CarouselNext className="right-2 disabled:hidden" />
          </Carousel>
        ) : null}
      </DialogPanel>

      <DialogFooter variant="bare" className={cn(selectedIds.size > 0 && "sm:justify-between")}>
        {/* Nothing ticked: continuing is the action, so it takes the primary slot. */}
        <DialogClose render={<Button variant={selectedIds.size === 0 ? "default" : "ghost"} />}>
          {t("continueWithout")}
        </DialogClose>
        {selectedIds.size > 0 ? (
          <Button onClick={addExtras}>{t("addToCart", { count: selectedIds.size })}</Button>
        ) : null}
      </DialogFooter>
    </>
  );
};
