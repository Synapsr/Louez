"use client";

import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InputQuantity } from "@louez/ui";
import { cn, isFixedPriceProduct, type StockQuantityLimit } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { SeasonalPriceBreakdown } from "@/components/storefront/product/seasonal-price-breakdown";
import { BillingDetail } from "@/components/storefront/product/billing-detail";
import { getStorefrontBillingDetail } from "@/lib/utils/util.storefront-product-pricing";
import { Price } from "@/components/storefront/ui/price";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { type CartItem, useCartDrawer } from "@/contexts/cart-context";
import { useFormatMoney } from "@/hooks/use-format-money";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import { getRequiredAccessoryLineMinimumQuantity } from "@/lib/utils/cart-required-accessories";

interface CartLineItemProps {
  item: CartItem;
  /** What the line can reach once sibling lines took their share of stock. */
  maximumQuantity: StockQuantityLimit;
  /** Set when the line is a required accessory owned by a parent line. */
  parent?: { name: string; quantity: number };
  onQuantityChange: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  /** Unused: the store currency is read from context. Kept for old callers. */
  currency?: string;
  globalStartDate?: string | null;
  globalEndDate?: string | null;
}

const formatAttributes = (attributes: Record<string, string> | undefined): string | null => {
  const entries = Object.entries(attributes ?? {});
  return entries.length > 0 ? entries.map(([, value]) => value).join(" · ") : null;
};

/**
 * One cart line: image, name, variant, quantity stepper and the line total on
 * the right. A required accessory cannot be removed or go below its minimum.
 */
export const CartLineItem = ({
  item,
  maximumQuantity,
  parent,
  onQuantityChange,
  onRemove,
  globalStartDate = null,
  globalEndDate = null,
}: CartLineItemProps) => {
  const t = useTranslations("storefront.cart");
  const formatMoney = useFormatMoney();
  const { close } = useCartDrawer();
  const productHref = `/product/${item.productId}`;

  const priceResult = calculateCartItemPrice(item, globalStartDate, globalEndDate);
  const { subtotal, seasonalSegments } = priceResult;
  const unitPrice = subtotal / Math.max(1, item.quantity);
  const isRequiredLine = Boolean(parent);
  const minimumQuantity = parent
    ? getRequiredAccessoryLineMinimumQuantity(item, parent.quantity)
    : 1;
  const attributes = formatAttributes(item.selectedAttributes);
  const isUnavailable = Boolean(item.unavailableReason);
  const stepperMax =
    maximumQuantity === null ? undefined : Math.max(minimumQuantity, maximumQuantity);

  return (
    <div
      className={cn("flex gap-3 py-4", isUnavailable && "opacity-70")}
      data-slot="cart-line-item"
      data-line-id={item.lineId}
    >
      <StorefrontLink
        href={productHref}
        onClick={close}
        className="shrink-0 self-start rounded-lg focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ProductImage
          src={item.productImage}
          alt={item.productName}
          sizes="96px"
          containerClassName={cn("shrink-0 rounded-lg", isRequiredLine ? "h-12" : "h-16")}
        />
      </StorefrontLink>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <StorefrontLink
              href={productHref}
              onClick={close}
              className="line-clamp-2 text-sm font-medium leading-snug hover:underline focus-visible:underline sm:text-base"
            >
              {item.productName}
            </StorefrontLink>
            {attributes ? (
              <p className="truncate text-xs text-muted-foreground">{attributes}</p>
            ) : null}
            {parent ? (
              <p className="truncate text-xs text-muted-foreground">
                {t("requiredWith", { name: parent.name })}
              </p>
            ) : null}
          </div>
          <Price amount={subtotal} size="sm" className="shrink-0" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <InputQuantity
            value={item.quantity}
            onChange={(quantity) => onQuantityChange(item.lineId, quantity)}
            min={minimumQuantity}
            max={stepperMax}
            editable={false}
            ariaLabel={t("quantityOf", { name: item.productName })}
            className="*:h-11 lg:*:h-9 [&_[data-slot=button]]:size-11 lg:[&_[data-slot=button]]:size-9"
          />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {subtotal === 0 && isRequiredLine
              ? t("included")
              : `${formatMoney(unitPrice)} × ${item.quantity}`}
            {isFixedPriceProduct(item) ? ` · ${t("fixedPrice")}` : null}
          </p>
          {!isRequiredLine ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="shrink-0 text-muted-foreground lg:size-9"
              aria-label={t("removeItem", { name: item.productName })}
              onClick={() => onRemove(item.lineId)}
            >
              <Trash2Icon aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>

        <BillingDetail
          detail={getStorefrontBillingDetail(item, priceResult, globalStartDate, globalEndDate)}
        />
        <SeasonalPriceBreakdown segments={seasonalSegments} seasons={item.seasonalPricings} />

        {item.unavailableReason ? (
          <p className="text-xs text-destructive">{t(`unavailable.${item.unavailableReason}`)}</p>
        ) : maximumQuantity !== null && item.quantity >= maximumQuantity ? (
          <p className="text-xs text-muted-foreground">{t("maxReached")}</p>
        ) : null}
      </div>
    </div>
  );
};
