'use client';

import Image from 'next/image';

import { format } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import { ImageIcon, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { CartItem } from '@/contexts/cart-context';
import { getDetailedDuration } from '@/lib/utils/duration';

import type { TaxSettings } from '@louez/types';
import { Badge, Card, CardContent, Separator } from '@louez/ui';
import { type ProductPricing, calculateRentalPrice, formatCurrency } from '@louez/utils';

import type { DeliveryOption, LineResolutionState } from '../types';
import { calculateDuration } from '../utils';

interface CheckoutOrderSummaryProps {
  items: CartItem[];
  pricingMode: 'day' | 'hour' | 'week';
  reservationMode: 'payment' | 'request';
  depositPercentage: number;
  taxSettings?: TaxSettings;
  currency: string;
  locale: 'fr' | 'en';
  globalStartDate: string | null;
  globalEndDate: string | null;
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  totalDeposit: number;
  totalWithDelivery: number;
  deliveryOption: DeliveryOption;
  deliveryDistance: number | null;
  deliveryFee: number;
  lineResolutions?: Record<
    string,
    LineResolutionState
  >;
}

export function CheckoutOrderSummary({
  items,
  pricingMode,
  reservationMode,
  depositPercentage,
  taxSettings,
  currency,
  locale,
  globalStartDate,
  globalEndDate,
  subtotal,
  originalSubtotal,
  totalSavings,
  totalDeposit,
  totalWithDelivery,
  deliveryOption,
  deliveryDistance,
  deliveryFee,
  lineResolutions = {},
}: CheckoutOrderSummaryProps) {
  const t = useTranslations('storefront.checkout');
  const tCart = useTranslations('storefront.cart');
  const dateLocale = locale === 'fr' ? fr : enUS;

  const durationLabel = (() => {
    if (!globalStartDate || !globalEndDate) return '';

    const { days, hours } = getDetailedDuration(globalStartDate, globalEndDate);

    if (pricingMode === 'hour') {
      return `${days * 24 + hours}h`;
    }

    if (days === 0) return `${hours}h`;
    if (hours === 0) return `${days}j`;
    return `${days}j ${hours}h`;
  })();

  return (
    <div className="lg:col-span-2">
      <Card className="sticky top-4">
        <CardContent className="space-y-4 pt-6">
          <h3 className="font-semibold">{t('summary')}</h3>

          {globalStartDate && globalEndDate && (
            <div className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {format(new Date(globalStartDate), 'dd MMM', {
                  locale: dateLocale,
                })}{' '}
                {'\u2192'}{' '}
                {format(new Date(globalEndDate), 'dd MMM', {
                  locale: dateLocale,
                })}
              </span>
              <Badge variant="secondary">{durationLabel}</Badge>
            </div>
          )}

          <div className="space-y-3">
            {items.map((item, index) => {
              const duration = calculateDuration(
                item.startDate,
                item.endDate,
                item.pricingMode,
              );

              const itemPricingMode = item.productPricingMode || pricingMode;
              let itemTotal = item.price * item.quantity * duration;
              let itemSavings = 0;
              let discountPercent: number | null = null;

              if (item.pricingTiers && item.pricingTiers.length > 0) {
                const pricing: ProductPricing = {
                  basePrice: item.price,
                  deposit: item.deposit,
                  pricingMode: itemPricingMode,
                  tiers: item.pricingTiers.map((tier, index) => ({
                    ...tier,
                    displayOrder: index,
                  })),
                };

                const result = calculateRentalPrice(pricing, duration, item.quantity);
                itemTotal = result.subtotal;
                itemSavings = result.savings;
                discountPercent = result.discountPercent;
              }

              const resolutionState = lineResolutions[item.lineId]
              const requestedAttributes = item.selectedAttributes
              const resolvedAttributes = item.resolvedAttributes
                || (resolutionState?.status === 'resolved'
                  ? resolutionState.selectedAttributes
                  : undefined)

              return (
                <div key={item.lineId || `${item.productId}-${index}`} className="flex gap-3">
                  <div className="bg-muted relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg">
                    {item.productImage ? (
                      <Image
                        src={item.productImage}
                        alt={item.productName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="text-muted-foreground h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.productName}</p>
                    {requestedAttributes && Object.keys(requestedAttributes).length > 0 && (
                      <p className="text-muted-foreground truncate text-[11px]">
                        {t('requestedAttributesLabel')}: {Object.entries(requestedAttributes)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' • ')}
                      </p>
                    )}
                    {resolvedAttributes && Object.keys(resolvedAttributes).length > 0 && (
                      <p className="text-muted-foreground truncate text-[11px]">
                        {t('resolvedAttributesLabel')}: {Object.entries(resolvedAttributes)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' • ')}
                      </p>
                    )}
                    {resolutionState?.status === 'loading' && (
                      <p className="text-muted-foreground truncate text-[11px]">
                        {t('lineCheckingAvailability')}
                      </p>
                    )}
                    {resolutionState?.status === 'invalid' && (
                      <p className="truncate text-[11px] text-destructive">
                        {t('lineNeedsUpdateInline')}
                      </p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      {item.quantity} {'\u00d7'} {formatCurrency(item.price, currency)} {'\u00d7'}{' '}
                      {duration}
                    </p>
                    {discountPercent && (
                      <Badge
                        variant="secondary"
                        className="mt-1 bg-green-100 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300"
                      >
                        -{discountPercent}%
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {formatCurrency(itemTotal, currency)}
                    </p>
                    {itemSavings > 0 && (
                      <p className="text-xs text-green-600">
                        -{formatCurrency(itemSavings, currency)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Separator />

          <div className="space-y-2">
            {totalSavings > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tCart('subtotal')}</span>
                  <span className="text-muted-foreground line-through">
                    {formatCurrency(originalSubtotal, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-green-600">
                  <span>{t('pricing.discount')}</span>
                  <span>-{formatCurrency(totalSavings, currency)}</span>
                </div>
              </>
            )}

            {deliveryOption === 'delivery' && deliveryDistance !== null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  {t('deliveryFee')}
                </span>
                <span className={deliveryFee === 0 ? 'font-medium text-green-600' : ''}>
                  {deliveryFee === 0 ? t('free') : formatCurrency(deliveryFee, currency)}
                </span>
              </div>
            )}

            <Separator />
            <div className="flex justify-between text-lg font-semibold">
              <span>{tCart('total')}</span>
              <span className="text-primary">
                {formatCurrency(totalWithDelivery, currency)}
              </span>
            </div>

            {reservationMode === 'payment' && depositPercentage < 100 && (
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-base font-semibold">
                  <span>{t('toPayNow')}</span>
                  <span className="text-primary">
                    {formatCurrency(
                      Math.round(subtotal * depositPercentage) / 100,
                      currency,
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('remainingAtPickup', {
                    amount: formatCurrency(
                      Math.round(subtotal * (100 - depositPercentage)) / 100,
                      currency,
                    ),
                  })}
                </p>
              </div>
            )}

            {taxSettings?.enabled && (
              <p className="text-muted-foreground pt-2 text-center text-xs">
                {taxSettings.displayMode === 'inclusive'
                  ? tCart('pricesIncludeTax')
                  : tCart('pricesExcludeTax')}
              </p>
            )}
          </div>

          {totalSavings > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {t('pricing.savingsBanner', {
                amount: formatCurrency(totalSavings, currency),
              })}
            </div>
          )}

          {totalDeposit > 0 && reservationMode === 'payment' && (
            <div className="mt-2 space-y-2 border-t pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('depositLabel')}</span>
                <span className="font-medium">
                  {formatCurrency(totalDeposit, currency)}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {t('depositAuthorizationInfo')}
              </p>
            </div>
          )}

          {totalDeposit > 0 && reservationMode !== 'payment' && (
            <div className="text-muted-foreground mt-2 border-t pt-3 text-xs">
              <p>
                {t('depositInfo', {
                  amount: formatCurrency(totalDeposit, currency),
                })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
