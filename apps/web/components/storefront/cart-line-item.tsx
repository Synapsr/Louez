'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { cn, formatCurrency, isFixedPriceProduct } from '@louez/utils';

import { ProductImage } from '@/components/product/product-image';

import { useFormatLocale } from '@/hooks/use-format-locale';

import { calculateCartItemPrice } from '@/lib/utils/cart-pricing';
import { getRequiredAccessoryLineMinimumQuantity } from '@/lib/utils/cart-required-accessories';

import type { CartItem } from '@/contexts/cart-context';

interface CartLineItemProps {
  item: CartItem;
  maximumQuantity: number;
  currency: string;
  globalStartDate: string | null;
  globalEndDate: string | null;
  /** Set when the line is a required accessory owned by a parent line. */
  parent?: { name: string; quantity: number };
  onQuantityChange: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
}

export const CartLineItem = ({
  item,
  maximumQuantity,
  currency,
  globalStartDate,
  globalEndDate,
  parent,
  onQuantityChange,
  onRemove,
}: CartLineItemProps) => {
  const t = useTranslations('storefront.cart');
  const tProduct = useTranslations('storefront.product');
  const { intl: formatLocale } = useFormatLocale();
  const formatMoney = (amount: number) =>
    formatCurrency(amount, currency, formatLocale);

  const subtotal = calculateCartItemPrice(
    item,
    globalStartDate,
    globalEndDate,
  ).subtotal;
  const unitPrice = subtotal / Math.max(1, item.quantity);
  const isRequiredLine = Boolean(parent);
  const minimumQuantity = parent
    ? getRequiredAccessoryLineMinimumQuantity(item, parent.quantity)
    : 1;

  return (
    <div
      className={cn(
        'bg-muted/30 flex gap-3 rounded-lg p-3',
        isRequiredLine && 'bg-muted/20 py-2',
      )}
    >
      <ProductImage
        src={item.productImage}
        alt={item.productName}
        sizes="88px"
        containerClassName={cn(
          'shrink-0 rounded-md',
          isRequiredLine ? 'h-12' : 'h-16',
        )}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.productName}</p>
        {item.selectedAttributes &&
          Object.keys(item.selectedAttributes).length > 0 && (
            <p className="text-muted-foreground truncate text-[11px]">
              {Object.entries(item.selectedAttributes)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' • ')}
            </p>
          )}

        {parent ? (
          <>
            <p className="text-muted-foreground truncate text-[11px]">
              {t('requiredWith', { name: parent.name })}
            </p>
            <p className="text-muted-foreground text-xs">
              {subtotal === 0
                ? t('included')
                : `${formatMoney(unitPrice)} × ${item.quantity}`}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            {formatMoney(unitPrice)} × {item.quantity}
            {isFixedPriceProduct(item)
              ? ` · ${tProduct('fixedPricingLabel')}`
              : null}
          </p>
        )}

        {/* Quantity Controls */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              aria-label={t('decreaseQuantity', { name: item.productName })}
              onClick={() => onQuantityChange(item.lineId, item.quantity - 1)}
              disabled={isRequiredLine && item.quantity <= minimumQuantity}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-6 text-center text-sm">{item.quantity}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              aria-label={t('increaseQuantity', { name: item.productName })}
              onClick={() => onQuantityChange(item.lineId, item.quantity + 1)}
              disabled={item.quantity >= maximumQuantity}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {!isRequiredLine && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive h-6 w-6"
              aria-label={t('remove')}
              onClick={() => onRemove(item.lineId)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
        {item.quantity >= maximumQuantity && (
          <p className="text-muted-foreground mt-1 text-[11px]">
            {t('lineMaxReached')}
          </p>
        )}

        {item.unavailableReason && (
          <p className="text-destructive mt-1 text-[11px]">
            {t(`unavailable.${item.unavailableReason}`)}
          </p>
        )}
      </div>
    </div>
  );
};
