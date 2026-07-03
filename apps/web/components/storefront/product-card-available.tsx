'use client';

import { useState } from 'react';

import Image from 'next/image';

import { Check, ImageIcon, Minus, Plus, TrendingDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Rate } from '@louez/types';
import type { CombinationAvailability } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Card, CardContent } from '@louez/ui';
import { Badge } from '@louez/ui';
import { cn, formatCurrency } from '@louez/utils';
import {
  type ProductPricing,
  type SeasonalPricingConfig,
  calculateDurationMinutes,
  calculateRateBasedPrice,
  calculateRentalPrice,
  calculateSeasonalAwarePrice,
  isRateBasedProduct,
} from '@louez/utils';
import type { PricingMode } from '@louez/utils';

import { calculateDuration, getDetailedDuration } from '@/lib/utils/duration';

import { useCart } from '@/contexts/cart-context';
import {
  useStoreCurrency,
  useStoreMaxDiscountPercent,
} from '@/contexts/store-context';

import { AccessoriesModal } from './accessories-modal';
import {
  AvailabilityBadge,
  type AvailabilityStatus,
} from './availability-badge';
import { ProductModal } from './product-modal';

interface PricingTier {
  id: string;
  minDuration: number | null;
  discountPercent: string | number | null;
  period?: number | null;
  price?: string | null;
}

interface Accessory {
  id: string;
  name: string;
  price: string;
  deposit: string;
  images: string[] | null;
  quantity: number;
  pricingMode: PricingMode | null;
  basePeriodMinutes?: number | null;
  pricingTiers?: PricingTier[];
}

interface ProductCardAvailableProps {
  product: {
    id: string;
    name: string;
    description: string | null;
    images: string[] | null;
    price: string;
    deposit: string | null;
    quantity: number;
    displayQuantity?: number;
    category?: { name: string } | null;
    pricingMode?: PricingMode | null;
    basePeriodMinutes?: number | null;
    enforceStrictTiers?: boolean;
    pricingTiers?: PricingTier[];
    videoUrl?: string | null;
    accessories?: Accessory[];
    trackUnits?: boolean | null;
    bookingAttributeAxes?: Array<{
      key: string;
      label: string;
      position: number;
    }> | null;
    units?: Array<{
      lifecycleStatus: 'active' | 'retired' | null;
      inDowntimeNow?: boolean;
      attributes: Record<string, string> | null;
    }>;
    seasonalPricings?: SeasonalPricingConfig[];
  };
  storeSlug: string;
  availableQuantity: number;
  startDate: string;
  endDate: string;
  availableCombinations?: CombinationAvailability[];
}

// Helper to convert tier discountPercent to number
function normalizeTiers(tiers?: PricingTier[]): {
  id: string;
  minDuration: number;
  discountPercent: number;
  displayOrder: number;
}[] {
  if (!tiers) return [];
  return tiers.map((tier, index) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent:
      typeof tier.discountPercent === 'string'
        ? parseFloat(tier.discountPercent ?? '0')
        : (tier.discountPercent ?? 0),
    displayOrder: index,
  }));
}

export function ProductCardAvailable({
  product,
  storeSlug,
  availableQuantity,
  startDate,
  endDate,
  availableCombinations = [],
}: ProductCardAvailableProps) {
  const t = useTranslations('storefront.product');
  const currency = useStoreCurrency();
  const maxDiscountPercent = useStoreMaxDiscountPercent();
  const {
    addItem,
    getCartLinesByProductId,
    getProductQuantityInCart,
    updateItemQuantityByLineId,
  } = useCart();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accessoriesModalOpen, setAccessoriesModalOpen] = useState(false);

  const cartLines = getCartLinesByProductId(product.id);
  const firstLine = cartLines[0];
  const cartQuantity = getProductQuantityInCart(product.id);
  const inCart = cartQuantity > 0;
  const totalQuantity = product.displayQuantity ?? product.quantity;

  const price = parseFloat(product.price);
  const deposit = product.deposit ? parseFloat(product.deposit) : 0;
  const mainImage = product.images?.[0];

  const effectivePricingMode: PricingMode = product.pricingMode ?? 'day';
  const pricedDuration = calculateDuration(
    startDate,
    endDate,
    effectivePricingMode,
  );
  const normalizedTiers = normalizeTiers(product.pricingTiers);
  const durationMinutes = calculateDurationMinutes(startDate, endDate);
  const rateTiers: Rate[] = (product.pricingTiers || [])
    .filter(
      (
        tier,
      ): tier is PricingTier & { period: number; price: string | number } =>
        typeof tier.period === 'number' &&
        tier.period > 0 &&
        (typeof tier.price === 'string' || typeof tier.price === 'number'),
    )
    .map((tier, index) => ({
      id: tier.id,
      period: tier.period,
      price:
        typeof tier.price === 'string' ? parseFloat(tier.price) : tier.price,
      displayOrder: index,
    }));

  const isRateBased = isRateBasedProduct({
    basePeriodMinutes: product.basePeriodMinutes,
  });

  // Use seasonal-aware calculation when seasonal pricings exist
  const hasSeasonalPricings = (product.seasonalPricings?.length ?? 0) > 0;

  const priceResult = hasSeasonalPricings
    ? (() => {
        const result = calculateSeasonalAwarePrice(
          {
            basePrice: price,
            basePeriodMinutes: product.basePeriodMinutes ?? null,
            deposit,
            pricingMode: effectivePricingMode,
            enforceStrictTiers: product.enforceStrictTiers ?? false,
            tiers: normalizedTiers,
            rates: rateTiers,
          },
          product.seasonalPricings!,
          startDate,
          endDate,
          1,
        );
        return {
          subtotal: result.subtotal,
          originalSubtotal: result.originalSubtotal,
          savings: result.savings,
          discountPercent:
            result.savings > 0 && result.originalSubtotal > 0
              ? Math.round((result.savings / result.originalSubtotal) * 100)
              : null,
        };
      })()
    : (() => {
        const result = isRateBased
          ? calculateRateBasedPrice(
              {
                basePrice: price,
                basePeriodMinutes: product.basePeriodMinutes!,
                deposit,
                rates: rateTiers,
                enforceStrictTiers: product.enforceStrictTiers ?? false,
              },
              durationMinutes,
              1,
            )
          : calculateRentalPrice(
              {
                basePrice: price,
                deposit,
                pricingMode: effectivePricingMode,
                tiers: normalizedTiers,
              } as ProductPricing,
              pricedDuration,
              1,
            );
        return {
          subtotal: result.subtotal,
          originalSubtotal: result.originalSubtotal,
          savings: result.savings,
          discountPercent:
            'reductionPercent' in result
              ? result.reductionPercent
              : result.discountPercent,
        };
      })();

  const totalPrice = priceResult.subtotal;
  const originalPrice = priceResult.originalSubtotal;
  const hasDiscount = priceResult.savings > 0;
  const discountPercent = priceResult.discountPercent;

  const status: AvailabilityStatus = inCart
    ? 'in_cart'
    : availableQuantity === 0
      ? 'unavailable'
      : availableQuantity < totalQuantity
        ? 'limited'
        : 'available';

  const maxQuantity = availableQuantity;
  const firstLineQuantity = firstLine?.quantity || 0;
  const firstLineMaxQuantity = firstLine?.maxQuantity || maxQuantity;
  const canAddMore = firstLineQuantity < firstLineMaxQuantity;
  const hasBookingAttributes = (product.bookingAttributeAxes?.length || 0) > 0;

  // Filter available accessories (active with stock)
  const availableAccessories = (product.accessories || []).filter(
    (acc) => acc.quantity > 0,
  );

  const detailedDuration = getDetailedDuration(startDate, endDate);
  const durationLabel = (() => {
    const { days, hours, totalHours } = detailedDuration;
    if (days === 0) {
      return `${totalHours} ${
        totalHours === 1
          ? t('pricingUnit.hour.singular')
          : t('pricingUnit.hour.plural')
      }`;
    }

    if (hours === 0) {
      return `${days} ${
        days === 1 ? t('pricingUnit.day.singular') : t('pricingUnit.day.plural')
      }`;
    }

    return `${days} ${
      days === 1 ? t('pricingUnit.day.singular') : t('pricingUnit.day.plural')
    } ${hours} ${
      hours === 1
        ? t('pricingUnit.hour.singular')
        : t('pricingUnit.hour.plural')
    }`;
  })();

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (status === 'unavailable') return;
    if (hasBookingAttributes) {
      setIsModalOpen(true);
      return;
    }

    if (inCart) {
      if (firstLine && canAddMore) {
        updateItemQuantityByLineId(firstLine.lineId, firstLine.quantity + 1);
        toastManager.add({
          title: t('addedToCart', { name: product.name }),
          type: 'success',
        });
      }
    } else {
      addItem(
        {
          productId: product.id,
          productName: product.name,
          productImage: mainImage || null,
          price,
          deposit,
          quantity: 1,
          maxQuantity,
          pricingMode: effectivePricingMode,
          basePeriodMinutes: product.basePeriodMinutes ?? null,
          enforceStrictTiers: product.enforceStrictTiers ?? false,
          pricingTiers: product.pricingTiers?.map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration ?? 1,
            discountPercent:
              typeof tier.discountPercent === 'string'
                ? parseFloat(tier.discountPercent ?? '0')
                : (tier.discountPercent ?? 0),
            period: tier.period ?? null,
            price:
              typeof tier.price === 'string'
                ? parseFloat(tier.price)
                : (tier.price ?? null),
          })),
          productPricingMode: product.pricingMode,
          seasonalPricings: product.seasonalPricings,
        },
        storeSlug,
      );

      // Show accessories modal if there are available accessories, otherwise show toast
      if (availableAccessories.length > 0) {
        setAccessoriesModalOpen(true);
      } else {
        toastManager.add({
          title: t('addedToCart', { name: product.name }),
          type: 'success',
        });
      }
    }
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (firstLine && firstLine.quantity > 0) {
      updateItemQuantityByLineId(firstLine.lineId, firstLine.quantity - 1);
    }
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const isUnavailable = status === 'unavailable';

  return (
    <>
      <Card
        className={cn(
          'group cursor-pointer gap-0 overflow-hidden p-0 transition-all duration-200',
          isUnavailable
            ? 'opacity-50'
            : 'hover:border-primary/20 hover:shadow-md',
        )}
        onClick={handleOpenModal}
      >
        {/* Image */}
        <div className="bg-muted relative aspect-[4/3] overflow-hidden">
          {mainImage ? (
            <Image
              src={mainImage}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 33vw"
              className={cn(
                'object-cover transition-transform duration-300',
                !isUnavailable && 'group-hover:scale-105',
              )}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="text-muted-foreground h-8 w-8 md:h-12 md:w-12" />
            </div>
          )}

          {/* Badge overlay */}
          <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2">
            <AvailabilityBadge
              status={status}
              availableQuantity={availableQuantity}
              totalQuantity={totalQuantity}
              cartQuantity={cartQuantity}
            />
          </div>

          {/* Quick add button - always visible on mobile, hover on desktop */}
          {!isUnavailable && (
            <>
              {/* Mobile: always visible floating button */}
              <div className="absolute right-1.5 bottom-1.5 md:hidden">
                {inCart && !hasBookingAttributes ? (
                  <div className="bg-background/95 flex items-center gap-1 rounded-full border p-0.5 shadow-lg backdrop-blur">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={handleDecrement}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center text-sm font-medium">
                      {cartQuantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={handleQuickAdd}
                      disabled={!canAddMore}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-full shadow-lg"
                    onClick={
                      hasBookingAttributes ? handleOpenModal : handleQuickAdd
                    }
                  >
                    {hasBookingAttributes && inCart ? (
                      <span className="text-xs font-semibold">
                        {cartQuantity}
                      </span>
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>

              {/* Desktop: hover overlay */}
              <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 md:block">
                {inCart && !hasBookingAttributes ? (
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleDecrement}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="px-3 font-medium text-white">
                      {cartQuantity}
                    </span>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleQuickAdd}
                      disabled={!canAddMore}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="h-9 w-full"
                    onClick={
                      hasBookingAttributes ? handleOpenModal : handleQuickAdd
                    }
                  >
                    {hasBookingAttributes && inCart ? (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {cartQuantity}
                      </>
                    ) : (
                      <>
                        <Plus className="mr-1 h-4 w-4" />
                        {t('addToCart')}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        <CardContent className="p-2.5 md:p-4">
          {/* Name */}
          <h3 className="group-hover:text-primary mb-1 line-clamp-2 text-sm font-medium transition-colors md:mb-2 md:text-base">
            {product.name}
          </h3>

          {/* Total price for the period */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {hasDiscount ? (
                <>
                  <span className="text-primary text-base font-bold md:text-lg">
                    {formatCurrency(totalPrice, currency)}
                  </span>
                  <span className="text-muted-foreground text-xs line-through">
                    {formatCurrency(originalPrice, currency)}
                  </span>
                </>
              ) : (
                <span className="text-primary text-base font-bold md:text-lg">
                  {formatCurrency(totalPrice, currency)}
                </span>
              )}
            </div>

            {/* Discount badge or cart indicator */}
            {hasDiscount &&
              !inCart &&
              discountPercent != null &&
              (maxDiscountPercent == null ||
                discountPercent <= maxDiscountPercent) && (
                <Badge className="bg-primary/10 text-primary shrink-0 text-xs">
                  <TrendingDown className="mr-0.5 h-3 w-3" />-
                  {Math.floor(discountPercent)}%
                </Badge>
              )}
            {inCart && (
              <div className="text-primary flex items-center gap-0.5">
                <Check className="h-3 w-3" />
                <span className="text-xs font-medium">{cartQuantity}</span>
              </div>
            )}
          </div>

          {/* Duration info */}
          <p className="text-muted-foreground mt-1 text-xs">{durationLabel}</p>
        </CardContent>
      </Card>

      {/* Product Modal */}
      <ProductModal
        product={product}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        storeSlug={storeSlug}
        availableQuantity={availableQuantity}
        startDate={startDate}
        endDate={endDate}
        availableCombinations={availableCombinations}
      />

      {/* Accessories Modal */}
      <AccessoriesModal
        open={accessoriesModalOpen}
        onOpenChange={setAccessoriesModalOpen}
        productName={product.name}
        accessories={availableAccessories.map((acc) => ({
          ...acc,
          pricingTiers: acc.pricingTiers?.map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration ?? 1,
            discountPercent:
              typeof tier.discountPercent === 'string'
                ? (tier.discountPercent ?? '0')
                : (tier.discountPercent ?? 0).toString(),
            period: tier.period ?? null,
            price: tier.price ?? null,
          })),
        }))}
        storeSlug={storeSlug}
        currency={currency}
      />
    </>
  );
}
