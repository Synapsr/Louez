'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  differenceInDays,
  differenceInHours,
  differenceInWeeks,
} from 'date-fns';
import { Minus, Plus, ShoppingCart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PricingMode } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Label } from '@louez/ui';
import { Badge } from '@louez/ui';
import { Separator } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { formatCurrency } from '@louez/utils';
import {
  type ProductPricing,
  allocateAcrossCombinations,
  buildCombinationKey,
  calculateRentalPrice,
  getAvailableDurations,
  getDeterministicCombinationSortValue,
  getSelectionCapacity,
  snapToNearestTier,
} from '@louez/utils';

import { AccessoriesModal } from '@/components/storefront/accessories-modal';
import {
  QuickDateButtons,
  RentalDatePicker,
} from '@/components/storefront/rental-date-picker';

import { getMinStartDate } from '@/lib/utils/duration';
import {
  formatDurationFromMinutes,
  validateMinRentalDurationMinutes,
} from '@/lib/utils/rental-duration';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

interface Accessory {
  id: string;
  name: string;
  price: string;
  deposit: string;
  images: string[] | null;
  quantity: number;
  pricingMode: PricingMode | null;
  pricingTiers?: {
    id: string;
    minDuration: number;
    discountPercent: string;
  }[];
}

interface AddToCartFormProps {
  productId: string;
  productName: string;
  productImage: string | null;
  price: number;
  deposit: number;
  maxQuantity: number;
  pricingMode: 'day' | 'hour' | 'week';
  storeSlug: string;
  pricingTiers?: { id: string; minDuration: number; discountPercent: number }[];
  enforceStrictTiers?: boolean;
  advanceNotice?: number;
  minRentalMinutes?: number;
  accessories?: Accessory[];
  trackUnits?: boolean;
  bookingAttributeAxes?: Array<{
    key: string;
    label: string;
    position: number;
  }>;
  bookingAttributeValues?: Record<string, string[]>;
  productUnits?: Array<{
    status: 'available' | 'maintenance' | 'retired' | null;
    attributes: Record<string, string> | null;
  }>;
  bookingCombinations?: Array<{
    combinationKey: string;
    selectedAttributes: Record<string, string>;
    availableQuantity: number;
  }>;
}

export function AddToCartForm({
  productId,
  productName,
  productImage,
  price,
  deposit,
  maxQuantity,
  pricingMode,
  storeSlug,
  pricingTiers,
  enforceStrictTiers = false,
  advanceNotice = 0,
  minRentalMinutes = 0,
  accessories = [],
  trackUnits = false,
  bookingAttributeAxes = [],
  bookingAttributeValues = {},
  productUnits = [],
  bookingCombinations = [],
}: AddToCartFormProps) {
  const t = useTranslations('storefront.product');
  const currency = useStoreCurrency();
  const { addItem, items: cartItems } = useCart();
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [quantity, setQuantity] = useState(1);
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({});
  const [accessoriesModalOpen, setAccessoriesModalOpen] = useState(false);
  const hasBookingAttributes = trackUnits && bookingAttributeAxes.length > 0;
  const fallbackCombinations = useMemo(() => {
    if (!hasBookingAttributes) {
      return [];
    }

    const byCombination = new Map<
      string,
      { selectedAttributes: Record<string, string>; availableQuantity: number }
    >();

    for (const unit of productUnits) {
      if ((unit.status || 'available') !== 'available') continue;

      const selected = unit.attributes || {};
      const combinationKey = buildCombinationKey(
        bookingAttributeAxes,
        selected,
      );
      const current = byCombination.get(combinationKey);

      if (!current) {
        byCombination.set(combinationKey, {
          selectedAttributes: selected,
          availableQuantity: 1,
        });
      } else {
        current.availableQuantity += 1;
        byCombination.set(combinationKey, current);
      }
    }

    return [...byCombination.entries()]
      .map(([combinationKey, value]) => ({
        combinationKey,
        selectedAttributes: value.selectedAttributes,
        availableQuantity: value.availableQuantity,
      }))
      .sort((a, b) => {
        const sortA = getDeterministicCombinationSortValue(
          bookingAttributeAxes,
          a.selectedAttributes,
        );
        const sortB = getDeterministicCombinationSortValue(
          bookingAttributeAxes,
          b.selectedAttributes,
        );
        return sortA.localeCompare(sortB, 'en');
      });
  }, [bookingAttributeAxes, hasBookingAttributes, productUnits]);
  const effectiveCombinations = useMemo(
    () =>
      bookingCombinations.length > 0
        ? bookingCombinations
        : fallbackCombinations,
    [bookingCombinations, fallbackCombinations],
  );
  const selectionCapacity = useMemo(
    () =>
      getSelectionCapacity(
        bookingAttributeAxes,
        effectiveCombinations,
        selectedAttributes,
      ),
    [bookingAttributeAxes, effectiveCombinations, selectedAttributes],
  );
  const shouldSplitAcrossCombinations =
    hasBookingAttributes && selectionCapacity.allocationMode === 'split';
  const effectiveMaxQuantity = hasBookingAttributes
    ? Math.min(maxQuantity, selectionCapacity.capacity)
    : maxQuantity;
  const isSelectionUnavailable =
    hasBookingAttributes && effectiveMaxQuantity === 0;

  const calculateDuration = () => {
    if (!startDate || !endDate) return 0;

    switch (pricingMode) {
      case 'hour':
        return Math.max(1, differenceInHours(endDate, startDate));
      case 'week':
        return Math.max(1, differenceInWeeks(endDate, startDate));
      default:
        return Math.max(1, differenceInDays(endDate, startDate));
    }
  };

  const rawDuration = calculateDuration();

  // When strict tiers are enforced, snap to the nearest valid tier bracket.
  // Example: with tiers at [3, 7] days, selecting 5 days → customer pays for 7 days.
  const availableDurations =
    enforceStrictTiers && pricingTiers?.length
      ? getAvailableDurations(pricingTiers, true)
      : null;
  const duration =
    availableDurations && rawDuration > 0
      ? snapToNearestTier(rawDuration, availableDurations)
      : rawDuration;

  // Calculate pricing with tiers
  const pricing: ProductPricing = {
    basePrice: price,
    deposit,
    pricingMode,
    tiers:
      pricingTiers?.map((tier, index) => ({
        ...tier,
        displayOrder: index,
      })) || [],
  };
  const priceResult = calculateRentalPrice(pricing, duration, quantity);
  const subtotal = priceResult.subtotal;
  const originalSubtotal = priceResult.originalSubtotal;
  const savings = priceResult.savings;
  const discountPercent = priceResult.discountPercent;
  const totalDeposit = deposit * quantity;

  // Filter accessories to only show available ones (in stock, active status is already filtered server-side, and not in cart)
  const cartProductIds = new Set(cartItems.map((item) => item.productId));
  const availableAccessories = accessories.filter(
    (acc) => acc.quantity > 0 && !cartProductIds.has(acc.id),
  );

  const handleAddToCart = () => {
    if (!startDate || !endDate) {
      toastManager.add({ title: t('selectDates'), type: 'error' });
      return;
    }

    if (isSelectionUnavailable) {
      toastManager.add({ title: t('selectionUnavailable'), type: 'error' });
      return;
    }

    // Validate minimum rental duration
    if (minRentalMinutes > 0) {
      const check = validateMinRentalDurationMinutes(
        startDate,
        endDate,
        minRentalMinutes,
      );
      if (!check.valid) {
        toastManager.add({
          title: t('minDurationError', {
            duration: formatDurationFromMinutes(minRentalMinutes),
          }),
          type: 'error',
        });
        return;
      }
    }

    if (shouldSplitAcrossCombinations) {
      const allocations = allocateAcrossCombinations(
        bookingAttributeAxes,
        effectiveCombinations,
        selectedAttributes,
        quantity,
      );
      if (!allocations || allocations.length === 0) {
        toastManager.add({ title: t('selectionUnavailable'), type: 'error' });
        return;
      }

      for (const allocation of allocations) {
        addItem(
          {
            productId,
            productName,
            productImage,
            price,
            deposit,
            quantity: allocation.quantity,
            maxQuantity: Math.max(
              1,
              allocation.combination.availableQuantity || 0,
            ),
            pricingMode,
            pricingTiers: pricingTiers?.map((tier) => ({
              id: tier.id,
              minDuration: tier.minDuration,
              discountPercent: tier.discountPercent,
            })),
            productPricingMode: pricingMode,
            selectedAttributes: allocation.combination.selectedAttributes,
          },
          storeSlug,
        );
      }
    } else {
      addItem(
        {
          productId,
          productName,
          productImage,
          price,
          deposit,
          quantity,
          maxQuantity: Math.max(1, effectiveMaxQuantity),
          pricingMode,
          pricingTiers: pricingTiers?.map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration,
            discountPercent: tier.discountPercent,
          })),
          productPricingMode: pricingMode,
          selectedAttributes,
        },
        storeSlug,
      );
    }

    // If there are available accessories, show the modal
    if (availableAccessories.length > 0) {
      setAccessoriesModalOpen(true);
    } else {
      // Otherwise show the classic toast
      toastManager.add({
        title: t('addedToCart', { name: productName }),
        type: 'success',
      });
    }
  };

  const handleQuickDateSelect = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  };

  useEffect(() => {
    if (effectiveMaxQuantity > 0 && quantity > effectiveMaxQuantity) {
      setQuantity(effectiveMaxQuantity);
    }
  }, [effectiveMaxQuantity, quantity]);

  return (
    <div className="space-y-5">
      {/* Quick Date Selection */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-sm">
          {t('quickSelect')}
        </Label>
        <QuickDateButtons
          onSelect={handleQuickDateSelect}
          pricingMode={pricingMode}
        />
      </div>

      {/* Date Selection */}
      <RentalDatePicker
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={(date) => {
          setEndDate(date);
          // Clear end date if it's before start date
          if (date && startDate && date < startDate) {
            setEndDate(undefined);
          }
        }}
        pricingMode={pricingMode}
        minDate={getMinStartDate(advanceNotice)}
        translations={{
          startDate: t('startDate'),
          endDate: t('endDate'),
          select: t('select'),
          selectTime: t('selectTime'),
        }}
      />

      {/* Quantity */}
      {bookingAttributeAxes.length > 0 && (
        <div className="space-y-2">
          <Label>{t('bookingAttributes')}</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {bookingAttributeAxes.map((axis) => (
              <Select
                key={axis.key}
                value={selectedAttributes[axis.key] || '__none__'}
                onValueChange={(value) => {
                  setSelectedAttributes((prev) => {
                    if (!value || value === '__none__') {
                      const next = { ...prev };
                      delete next[axis.key];
                      return next;
                    }

                    return { ...prev, [axis.key]: value };
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={axis.label}>
                    {selectedAttributes[axis.key] || axis.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="__none__"
                    label={t('bookingAttributeNone')}
                  >
                    {t('bookingAttributeNone')}
                  </SelectItem>
                  {(bookingAttributeValues[axis.key] || []).length > 0 ? (
                    (bookingAttributeValues[axis.key] || []).map((value) => (
                      <SelectItem key={value} value={value} label={value}>
                        {value}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem
                      value={`__empty_${axis.key}`}
                      label={axis.label}
                      disabled
                    >
                      {t('bookingAttributesNoOptions', {
                        attribute: axis.label,
                      })}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            {t('bookingAttributesHelp')}
          </p>
          <div className="space-y-1">
            <p className="text-xs font-medium">
              {t('availableForSelection', { count: effectiveMaxQuantity })}
            </p>
            <p className="text-muted-foreground text-xs">
              {selectionCapacity.allocationMode === 'single'
                ? t('quantityPerCombinationHint')
                : t('quantityCanSplitHint')}
            </p>
          </div>
        </div>
      )}

      {/* Quantity */}
      <div className="space-y-2">
        <Label>{t('quantity')}</Label>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-lg font-medium">
            {quantity}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              setQuantity(
                Math.min(Math.max(1, effectiveMaxQuantity), quantity + 1),
              )
            }
            disabled={
              quantity >= effectiveMaxQuantity || isSelectionUnavailable
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
          <span className="text-muted-foreground text-sm">
            (
            {t('availableCount', {
              count: hasBookingAttributes ? effectiveMaxQuantity : maxQuantity,
            })}
            )
          </span>
        </div>
      </div>

      {/* Price Summary */}
      {startDate && endDate && duration > 0 && (
        <div className="bg-muted/30 space-y-2 rounded-lg border p-4">
          <div className="flex justify-between text-sm">
            <span>
              {formatCurrency(price, currency)} x {quantity} x {duration}{' '}
              {duration > 1
                ? t(`pricingUnit.${pricingMode}.plural`)
                : t(`pricingUnit.${pricingMode}.singular`)}
            </span>
            {savings > 0 ? (
              <span className="text-muted-foreground line-through">
                {formatCurrency(originalSubtotal, currency)}
              </span>
            ) : (
              <span>{formatCurrency(subtotal, currency)}</span>
            )}
          </div>
          {savings > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span className="flex items-center gap-2">
                {t('tieredPricing.discountApplied')}
                {discountPercent && (
                  <Badge
                    variant="secondary"
                    className="bg-green-100 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300"
                  >
                    -{Math.floor(discountPercent)}%
                  </Badge>
                )}
              </span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
          )}
          {totalDeposit > 0 && (
            <div className="text-muted-foreground flex justify-between text-sm">
              <span>{t('deposit')}</span>
              <span>{formatCurrency(totalDeposit, currency)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-semibold">
            <span>{t('total')}</span>
            <span>{formatCurrency(subtotal + totalDeposit, currency)}</span>
          </div>
          {savings > 0 && (
            <div className="pt-1 text-center text-xs text-green-600">
              {t('tieredPricing.youSave', {
                amount: formatCurrency(savings, currency),
              })}
            </div>
          )}
        </div>
      )}

      {/* Add to Cart Button */}
      <Button
        size="lg"
        className="w-full"
        onClick={handleAddToCart}
        disabled={!startDate || !endDate || isSelectionUnavailable}
      >
        <ShoppingCart className="mr-2 h-5 w-5" />
        {t('addToCart')}
      </Button>

      {/* Accessories Modal */}
      <AccessoriesModal
        open={accessoriesModalOpen}
        onOpenChange={setAccessoriesModalOpen}
        productName={productName}
        accessories={availableAccessories}
        storeSlug={storeSlug}
        currency={currency}
      />
    </div>
  );
}
