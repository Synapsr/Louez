"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Button, DialogFooter, DialogPanel } from "@louez/ui";
import { ProductImage } from "@/components/product/product-image";
import { Price } from "@/components/storefront/ui/price";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { BookingAttributeSelects } from "./booking-attribute-selects";
import { QuantityStepper } from "./quantity-stepper";
import type { ProductCardPricing } from "./use-product-card-pricing";

type Attributes = ComponentProps<typeof BookingAttributeSelects>;
export interface QuickAddVariantViewProps {
  product: StorefrontCatalogProduct;
  pricing: ProductCardPricing;
  axes: Attributes["axes"];
  values: Attributes["values"];
  selected: Attributes["selected"];
  onSelectedChange: Attributes["onChange"];
  quantity: number;
  maxQuantity: number | null;
  onQuantityChange: (value: number) => void;
  isChecking: boolean;
  disabled: boolean;
  onConfirm: () => void;
}

export const QuickAddVariantView = ({
  product,
  pricing,
  axes,
  values,
  selected,
  onSelectedChange,
  quantity,
  maxQuantity,
  onQuantityChange,
  isChecking,
  disabled,
  onConfirm,
}: QuickAddVariantViewProps) => {
  const t = useTranslations("storefront");
  return (
    <>
      <DialogPanel className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <ProductImage
            src={product.images?.[0]}
            alt=""
            sizes="64px"
            containerClassName="w-16 shrink-0 rounded-lg"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-medium text-sm">{product.name}</p>
            <Price
              amount={pricing.amount}
              compareAt={pricing.compareAt}
              per={pricing.per}
              label={pricing.label}
              size="sm"
            />
          </div>
        </div>

        <p className="text-muted-foreground text-sm">{t("quickAdd.optionsIntro")}</p>

        <BookingAttributeSelects
          axes={axes}
          values={values}
          selected={selected}
          onChange={onSelectedChange}
          hint={
            isChecking
              ? t("product.booking.checking")
              : t("product.availableForSelection", { count: maxQuantity ?? 0 })
          }
        />

        <QuantityStepper
          value={quantity}
          max={maxQuantity}
          onChange={onQuantityChange}
          disabled={disabled}
        />
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button className="w-full sm:w-auto" onClick={onConfirm} disabled={disabled}>
          {t("product.addToCart")}
        </Button>
      </DialogFooter>
    </>
  );
};
