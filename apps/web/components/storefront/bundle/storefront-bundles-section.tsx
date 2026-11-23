"use client";

import { useState } from "react";

import { Package } from "lucide-react";

import { Dialog, DialogHeader, DialogPopup, DialogTitle, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { PeriodEditor } from "@/components/storefront/date-picker/period-editor";
import type { ProductCardPeriod } from "@/components/storefront/product/util.product-card";
import { useCartActions, useCartDrawer, useCartState } from "@/contexts/cart-context";
import { useStorePeriodRules } from "@/contexts/store-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { StorefrontProductBundle } from "@/lib/storefront/bundles.queries";
import { toCartLineInput } from "@/lib/utils/util.cart-line-input";

import { StorefrontBundleCard } from "./storefront-bundle-card";

interface StorefrontBundlesSectionProps {
  bundles: StorefrontProductBundle[];
  period?: ProductCardPeriod | null;
  className?: string;
}

export const StorefrontBundlesSection = ({
  bundles,
  period,
  className,
}: StorefrontBundlesSectionProps) => {
  const { addItem, setPeriod, setPricingMode } = useCartActions();
  const { period: cartPeriod } = useCartState();
  const drawer = useCartDrawer();
  const rules = useStorePeriodRules();
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const [pendingBundle, setPendingBundle] = useState<StorefrontProductBundle | null>(null);

  if (bundles.length === 0) {
    return null;
  }

  const commitBundleToCart = (bundle: StorefrontProductBundle, targetPeriod: ProductCardPeriod) => {
    for (const item of bundle.items) {
      addItem(
        toCartLineInput(item.product, {
          quantity: item.quantity,
          maxQuantity: item.product.quantity,
        }),
        {
          startDate: targetPeriod.startDate,
          endDate: targetPeriod.endDate,
        },
      );
    }

    toastManager.add({
      title: `Dodano zestaw „${bundle.name}” do koszyka`,
      type: "success",
    });
    drawer.open();
  };

  const handleSelectBundle = (bundle: StorefrontProductBundle) => {
    const activePeriod =
      period ??
      (cartPeriod ? { startDate: cartPeriod.startDate, endDate: cartPeriod.endDate } : null);

    if (!activePeriod) {
      setPendingBundle(bundle);
      return;
    }

    commitBundleToCart(bundle, activePeriod);
  };

  const handleApplyPeriod = (value: RentalPeriodValue) => {
    if (!pendingBundle) return;
    const nextPeriod: ProductCardPeriod = {
      startDate: value.start.toISOString(),
      endDate: value.end.toISOString(),
    };
    setPricingMode(rules.pricingMode);
    setPeriod(nextPeriod.startDate, nextPeriod.endDate);
    const bundleToAdd = pendingBundle;
    setPendingBundle(null);
    commitBundleToCart(bundleToAdd, nextPeriod);
  };

  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Package className="size-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">Gotowe zestawy produktów</h2>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Wybierz skonfigurowany zestaw sprzętu i dodaj wszystkie wchodzące w jego skład produkty
          jednym kliknięciem.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {bundles.map((bundle) => (
          <StorefrontBundleCard
            key={bundle.id}
            bundle={bundle}
            onSelectBundle={handleSelectBundle}
          />
        ))}
      </div>

      <Dialog
        open={pendingBundle !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBundle(null);
        }}
      >
        <DialogPopup className="sm:max-w-3xl">
          <DialogHeader className="gap-2">
            <DialogTitle>Wybierz termin wynajmu dla zestawu</DialogTitle>
            {pendingBundle ? (
              <p className="text-muted-foreground text-sm">{pendingBundle.name}</p>
            ) : null}
          </DialogHeader>
          {pendingBundle ? (
            <PeriodEditor
              key={pendingBundle.id}
              productId={pendingBundle.items[0]?.product.id}
              value={null}
              rules={rules}
              variant="sheet"
              months={isDesktop ? 2 : 1}
              onApply={handleApplyPeriod}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </section>
  );
};
