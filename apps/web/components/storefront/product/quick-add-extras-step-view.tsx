"use client";

import { useState } from "react";

import { CheckCircle2, PlusCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button, DialogClose, DialogFooter, DialogPanel } from "@louez/ui";
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
  cartProductIds: ReadonlySet<string>;
  onAddExtras: (extras: StorefrontCatalogProduct[]) => void;
}

/**
 * The accessories that go with a product just added: clearly separated into
 * required accessories (automatically added to the cart) and optional accessories
 * (freely selectable by the customer).
 */
export const QuickAddExtrasStepView = ({
  product,
  period,
  quantity = 1,
  onDone,
  cartProductIds,
  onAddExtras,
}: QuickAddExtrasStepProps) => {
  const t = useTranslations("storefront.accessories");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const extras = selectOfferableExtras(product.accessories, cartProductIds);
  const required = selectRequiredAccessories(product.accessories ?? []);

  const addExtras = () => {
    onAddExtras(extras.filter((extra) => selectedIds.has(extra.id)));
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
      <DialogPanel className="flex flex-col gap-5">
        {required.length > 0 ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  <h4 className="text-sm font-semibold text-foreground">
                    {t("requiredSectionTitle")}
                  </h4>
                </div>
                <Badge variant="progress">{t("requiredSectionBadge")}</Badge>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("requiredSectionDescription")}
              </p>
            </div>
            <ExtrasList
              accessories={required}
              cartProductIds={cartProductIds}
              onToggle={toggle}
              quantity={quantity}
              selectedIds={selectedIds}
            />
          </section>
        ) : null}

        {extras.length > 0 ? (
          <section className="flex flex-col gap-3.5 rounded-2xl border border-border bg-muted/25 p-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PlusCircle className="size-4 shrink-0 text-foreground" />
                  <h4 className="text-sm font-semibold text-foreground">
                    {t("optionalSectionTitle")}
                  </h4>
                </div>
                <Badge variant="tertiary">{t("optionalSectionBadge")}</Badge>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("optionalSectionDescription")}
              </p>
            </div>

            <Carousel opts={{ align: "start", containScroll: "trimSnaps" }}>
              <CarouselContent className="-ml-3">
                {extras.map((extra) => (
                  <CarouselItem
                    data-extra-id={extra.id}
                    key={extra.id}
                    className="basis-1/2 pl-3 sm:basis-1/3"
                  >
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
          </section>
        ) : null}
      </DialogPanel>

      <DialogFooter variant="bare" className={cn(selectedIds.size > 0 && "sm:justify-between")}>
        {/* Nothing ticked: continuing is the action, so it takes the primary slot. */}
        <DialogClose render={<Button variant={selectedIds.size === 0 ? "default" : "ghost"} />}>
          {extras.length === 0 ? t("closePopup") : t("continueWithout")}
        </DialogClose>
        {selectedIds.size > 0 ? (
          <Button data-demo-target="extras-confirm" onClick={addExtras}>
            {t("addToCart", { count: selectedIds.size })}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
};
