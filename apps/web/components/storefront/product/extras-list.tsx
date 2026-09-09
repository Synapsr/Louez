"use client";

import { useTranslations } from "next-intl";

import { Badge, Checkbox } from "@louez/ui";
import { cn } from "@louez/utils";
import { isFixedPriceProduct, pricingModeToMinutes } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { Price } from "@/components/storefront/ui/price";

import type { AccessoryLink } from "@/lib/storefront/storefront.types";
import {
  getRequiredAccessoryUnitQuantity,
  selectOptionalAccessories,
  selectRequiredAccessories,
} from "@/lib/utils/cart-required-accessories";
import { parseStorefrontDecimal } from "@/lib/utils/util.storefront-product-pricing";

import { usePeriodLabel } from "@/hooks/use-period-label";

interface ExtrasListProps {
  accessories: AccessoryLink[];
  /** Units of the parent product, to size the required rows. */
  quantity: number;
  /** Optional accessories the customer ticked. */
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Products already in the cart; an optional accessory in it is not offered again. */
  cartProductIds: ReadonlySet<string>;
}

/**
 * Accessories inline, no modal: required ones are listed as included
 * (the cart adds them itself), optional ones are tickable rows with their
 * price. Nothing renders when the product has neither.
 */
export const ExtrasList = ({
  accessories,
  quantity,
  selectedIds,
  onToggle,
  cartProductIds,
}: ExtrasListProps) => {
  const t = useTranslations("storefront.product");
  const formatPeriodLabel = usePeriodLabel();
  const required = selectRequiredAccessories(accessories);
  const optional = selectOptionalAccessories(accessories).filter(
    (accessory) =>
      (accessory.quantity === null || accessory.quantity > 0) && !cartProductIds.has(accessory.id),
  );

  if (required.length === 0 && optional.length === 0) {
    return null;
  }

  const priceSuffix = (accessory: AccessoryLink) =>
    isFixedPriceProduct(accessory)
      ? { label: t("fixedPricingLabel") }
      : {
          per: formatPeriodLabel(
            accessory.basePeriodMinutes && accessory.basePeriodMinutes > 0
              ? accessory.basePeriodMinutes
              : pricingModeToMinutes(accessory.pricingMode ?? "day"),
          ),
        };

  return (
    <div className="flex flex-col gap-3">
      {required.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label={t("booking.included")}>
          {required.map((accessory) => {
            const units = getRequiredAccessoryUnitQuantity(accessory) * quantity;
            const isShort = accessory.quantity !== null && accessory.quantity < units;
            return (
              <li key={accessory.id} className="flex min-h-9 items-center gap-3 text-sm">
                <ProductImage
                  src={accessory.images?.[0] ?? null}
                  alt=""
                  sizes="40px"
                  containerClassName="size-10 shrink-0 rounded-lg"
                />
                <span className="min-w-0 flex-1 truncate">
                  {accessory.name}
                  {units > 1 ? <span className="text-muted-foreground"> ×{units}</span> : null}
                </span>
                <Badge variant={isShort ? "failed" : "tertiary"}>
                  {isShort ? t("booking.shortage") : t("booking.included")}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}

      {optional.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("booking.extras")}</legend>
          {optional.map((accessory) => {
            const checked = selectedIds.has(accessory.id);
            return (
              <label
                key={accessory.id}
                className={cn(
                  "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-sm transition-colors hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                  checked ? "border-primary/40 bg-primary/5" : "border-border",
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => onToggle(accessory.id)} />
                <ProductImage
                  src={accessory.images?.[0] ?? null}
                  alt=""
                  sizes="40px"
                  containerClassName="size-10 shrink-0 rounded-lg"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="wrap-break-word leading-snug">{accessory.name}</span>
                  <Price
                    amount={parseStorefrontDecimal(accessory.price) ?? 0}
                    size="sm"
                    {...priceSuffix(accessory)}
                  />
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
};
