"use client";

import { CheckCircle2, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Checkbox, Tooltip, TooltipPopup, TooltipTrigger } from "@louez/ui";
import { cn, isFixedPriceProduct, pricingModeToMinutes } from "@louez/utils";

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
  /** Whether to show a section header above required items (useful on product page inline booking panel). */
  showRequiredHeader?: boolean;
}

/**
 * Accessories inline, no modal: required ones are listed with their unit
 * price and a hint that the cart adds them itself (a free one reads
 * "included"), optional ones are tickable rows with their price. Nothing
 * renders when the product has neither.
 */
export const ExtrasList = ({
  accessories,
  quantity,
  selectedIds,
  onToggle,
  cartProductIds,
  showRequiredHeader = false,
}: ExtrasListProps) => {
  const t = useTranslations("storefront.product");
  const tAccessories = useTranslations("storefront.accessories");
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
        <div className="flex flex-col gap-2">
          {showRequiredHeader ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tAccessories("requiredSectionTitle")}
              </span>
              <Badge variant="progress">{tAccessories("autoAddedBadge")}</Badge>
            </div>
          ) : null}
          <ul className="flex flex-col gap-2" aria-label={t("booking.included")}>
            {required.map((accessory) => {
              const units = getRequiredAccessoryUnitQuantity(accessory) * quantity;
              const isShort = accessory.quantity !== null && accessory.quantity < units;
              const unitPrice = parseStorefrontDecimal(accessory.price) ?? 0;
              return (
                <li
                  key={accessory.id}
                  className="flex min-h-12 items-center gap-3 rounded-xl border border-primary/20 bg-background/90 px-3 py-2 text-sm shadow-2xs"
                >
                  <ProductImage
                    src={accessory.images?.[0] ?? null}
                    alt=""
                    sizes="40px"
                    containerClassName="size-10 shrink-0 rounded-lg"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="font-medium leading-snug">{accessory.name}</span>
                      {units > 1 ? (
                        <Badge variant="tertiary" className="shrink-0">
                          ×{units}
                        </Badge>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger
                          aria-label={t("booking.requiredHelp")}
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <CircleHelp aria-hidden="true" className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup className="max-w-64">{t("booking.requiredHelp")}</TooltipPopup>
                      </Tooltip>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="size-3 shrink-0" />
                      {tAccessories("autoAddedBadge")}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isShort ? (
                      <Badge variant="failed">{t("booking.shortage")}</Badge>
                    ) : unitPrice > 0 ? (
                      <Price amount={unitPrice} size="sm" {...priceSuffix(accessory)} />
                    ) : (
                      <Badge variant="tertiary">{t("booking.included")}</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
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
