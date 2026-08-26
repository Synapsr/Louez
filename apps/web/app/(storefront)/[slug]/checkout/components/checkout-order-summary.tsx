'use client';

import { format } from 'date-fns';
import { CalendarDays, Shield, Tag, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { TaxSettings } from '@louez/types';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui';
import { cn, formatCurrency, isFixedPriceProduct } from '@louez/utils';

import { ProductImage } from '@/components/product/product-image';
import { useFormatLocale } from '@/hooks/use-format-locale';

import { getDetailedDuration } from '@/lib/utils/duration';
import { calculateCartItemPrice } from '@/lib/utils/cart-pricing';
import { groupCartLinesByParent } from '@/lib/utils/cart-required-accessories';

import type { CartItem } from '@/contexts/cart-context';
import { useStoreMaxDiscountPercent } from '@/contexts/store-context';

import type { ValidatedPromo } from '../promo-actions';
import type { LineResolutionState } from '../types';
import { CheckoutPromoCode } from './checkout-promo-code';

interface CheckoutOrderSummaryProps {
  items: CartItem[];
  pricingMode: 'day' | 'hour' | 'week';
  reservationMode: 'payment' | 'request';
  depositPercentage: number;
  taxSettings?: TaxSettings;
  currency: string;
  globalStartDate: string | null;
  globalEndDate: string | null;
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  totalDeposit: number;
  totalWithDelivery: number;
  hasDeliveryLegs: boolean;
  deliveryFee: number;
  tulipInsurance?: {
    enabled: boolean;
    mode: 'required' | 'optional' | 'no_public';
  };
  tulipInsuranceOptIn: boolean;
  isTulipQuoteLoading: boolean;
  isTulipQuoteFetched: boolean;
  tulipQuotePreview?: {
    mode: 'required' | 'optional' | 'no_public';
    quoteUnavailable: boolean;
    quoteError: string | null;
    appliedOptIn: boolean;
    amount: number;
    insuredProductCount: number;
    uninsuredProductCount: number;
    insuredProductIds: string[];
    error: string | null;
  };
  lineResolutions?: Record<string, LineResolutionState>;
  hasActivePromoCodes?: boolean;
  storeId?: string;
  appliedPromo: ValidatedPromo | null;
  discountAmount: number;
  onApplyPromo: (promo: ValidatedPromo) => void;
  onRemovePromo: () => void;
  onEditDates: () => void;
}

export function CheckoutOrderSummary({
  items,
  pricingMode,
  reservationMode,
  depositPercentage,
  taxSettings,
  currency,
  globalStartDate,
  globalEndDate,
  subtotal,
  originalSubtotal,
  totalSavings,
  totalDeposit,
  totalWithDelivery,
  hasDeliveryLegs,
  deliveryFee,
  tulipInsurance,
  tulipInsuranceOptIn,
  isTulipQuoteLoading,
  isTulipQuoteFetched,
  tulipQuotePreview,
  lineResolutions = {},
  hasActivePromoCodes,
  storeId,
  appliedPromo,
  discountAmount,
  onApplyPromo,
  onRemovePromo,
  onEditDates,
}: CheckoutOrderSummaryProps) {
  const t = useTranslations('storefront.checkout');
  const tCart = useTranslations('storefront.cart');
  const tProduct = useTranslations('storefront.product');
  const tErrors = useTranslations('errors');
  const { intl: formatLocale, dateFns: dateLocale } = useFormatLocale();
  const formatMoney = (amount: number, currencyOverride = currency) =>
    formatCurrency(amount, currencyOverride, formatLocale);
  const maxDiscountPercent = useStoreMaxDiscountPercent();
  const showInsuranceUi =
    tulipInsurance?.enabled && tulipInsurance.mode !== 'no_public';
  const showInsuranceSummary = showInsuranceUi && !isTulipQuoteLoading && isTulipQuoteFetched;
  const insuredProductIdSet = new Set(
    tulipQuotePreview?.insuredProductIds ?? [],
  );
  const estimatedInsuranceAmount =
    tulipQuotePreview?.appliedOptIn && tulipQuotePreview.amount > 0
      ? tulipQuotePreview.amount
      : 0;
  const totalWithEstimatedInsurance =
    totalWithDelivery + estimatedInsuranceAmount;
  const subtotalWithEstimatedInsurance = subtotal + estimatedInsuranceAmount;
  const tulipQuoteErrorMessage =
    tulipQuotePreview?.quoteError?.startsWith('errors.')
      ? tErrors(tulipQuotePreview.quoteError.slice('errors.'.length) as never)
      : null;

  // Required accessories are listed right under the line they belong to.
  const orderedLines: Array<{ item: CartItem; parentName?: string }> =
    groupCartLinesByParent(items).flatMap((group) => [
      { item: group.line },
      ...group.children.map((child) => ({
        item: child,
        parentName: group.line.productName,
      })),
    ]);

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
            <div className="bg-muted/50 flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {format(new Date(globalStartDate), 'dd MMM', {
                  locale: dateLocale,
                })}{' '}
                {'\u2192'}{' '}
                {format(new Date(globalEndDate), 'dd MMM', {
                  locale: dateLocale,
                })}
              </span>
              <Badge variant="expired" className="ml-auto">
                {durationLabel}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onEditDates}
                aria-label={tCart('updateDates')}
              >
                <CalendarDays />
              </Button>
            </div>
          )}

          <div className="space-y-3">
            <TooltipProvider>
              {orderedLines.map(({ item, parentName }, index) => {
                const priceResult = calculateCartItemPrice(
                  item,
                  globalStartDate,
                  globalEndDate,
                );
                const itemTotal = priceResult.subtotal;
                const itemSavings = priceResult.savings;
                const discountPercent = priceResult.discountPercent;
                const resolutionState = lineResolutions[item.lineId];
                const requestedAttributes = item.selectedAttributes;
                const resolvedAttributes =
                  item.resolvedAttributes ||
                  (resolutionState?.status === 'resolved'
                    ? resolutionState.selectedAttributes
                    : undefined);
                const isInsuredProduct =
                  showInsuranceSummary && insuredProductIdSet.has(item.productId);

                return (
                  <div
                    key={item.lineId || `${item.productId}-${index}`}
                    className={cn(
                      'flex gap-3',
                      parentName && 'border-border ml-4 border-l pl-3',
                    )}
                  >
                    <ProductImage
                      src={item.productImage}
                      alt={item.productName}
                      sizes="76px"
                      containerClassName="h-14 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-sm font-medium">
                          {item.productName}
                        </p>
                        {isInsuredProduct && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="cursor-help">
                                  <Shield className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                </span>
                              }
                            />
                            <TooltipContent side="top">
                              <p>{t('insuranceEligibleProductTooltip')}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {requestedAttributes &&
                        Object.keys(requestedAttributes).length > 0 && (
                          <p className="text-muted-foreground truncate text-[11px]">
                            {t('requestedAttributesLabel')}:{' '}
                            {Object.entries(requestedAttributes)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(' • ')}
                          </p>
                        )}
                      {resolvedAttributes &&
                        Object.keys(resolvedAttributes).length > 0 && (
                          <p className="text-muted-foreground truncate text-[11px]">
                            {t('resolvedAttributesLabel')}:{' '}
                            {Object.entries(resolvedAttributes)
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
                        <p className="text-destructive truncate text-[11px]">
                          {t('lineNeedsUpdateInline')}
                        </p>
                      )}
                      {item.unavailableReason && (
                        <p className="text-destructive truncate text-[11px]">
                          {tCart(`unavailable.${item.unavailableReason}`)}
                        </p>
                      )}
                      {parentName && (
                        <p className="text-muted-foreground truncate text-[11px]">
                          {tCart('requiredWith', { name: parentName })}
                        </p>
                      )}
                      <p className="text-muted-foreground text-xs">
                        {parentName && itemTotal === 0 ? (
                          tCart('included')
                        ) : (
                          <>
                            {item.quantity} {'\u00d7'}{' '}
                            {formatMoney(
                              itemTotal / Math.max(1, item.quantity),
                              currency,
                            )}
                            {isFixedPriceProduct(item)
                              ? ` \u00b7 ${tProduct('fixedPricingLabel')}`
                              : null}
                          </>
                        )}
                      </p>
                      {discountPercent != null && discountPercent > 0 &&
                        (maxDiscountPercent == null || discountPercent <= maxDiscountPercent) && (
                          <Badge variant="success" className="mt-1 text-xs">
                            -{Math.floor(discountPercent)}%
                          </Badge>
                        )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatMoney(itemTotal, currency)}
                      </p>
                      {itemSavings > 0 && (
                        <p className="text-xs text-green-600">
                          -{formatMoney(itemSavings, currency)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </TooltipProvider>
          </div>

          <Separator />

          <div className="space-y-2">
            {totalSavings > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {tCart('subtotal')}
                  </span>
                  <span className="text-muted-foreground line-through">
                    {formatMoney(originalSubtotal, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-green-600">
                  <span>{t('pricing.discount')}</span>
                  <span>-{formatMoney(totalSavings, currency)}</span>
                </div>
              </>
            )}

            {hasActivePromoCodes && storeId && (
              <CheckoutPromoCode
                storeId={storeId}
                subtotal={subtotal}
                currency={currency}
                appliedPromo={appliedPromo}
                onApply={onApplyPromo}
                onRemove={onRemovePromo}
              />
            )}

            {discountAmount > 0 && appliedPromo && (
              <div className="flex justify-between text-sm text-green-600">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  {t('promoCode.discount', { code: appliedPromo.code })}
                </span>
                <span>-{formatMoney(discountAmount, currency)}</span>
              </div>
            )}

            {hasDeliveryLegs && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  {t('deliveryFee')}
                </span>
                <span
                  className={
                    deliveryFee === 0 ? 'font-medium text-green-600' : ''
                  }
                >
                  {deliveryFee === 0
                    ? t('free')
                    : formatMoney(deliveryFee, currency)}
                </span>
              </div>
            )}

            {showInsuranceSummary && tulipInsurance?.mode === 'required' && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('insuranceLineLabel')}
                </span>
                <span>
                  {estimatedInsuranceAmount > 0
                    ? formatMoney(estimatedInsuranceAmount, currency)
                    : t('insuranceRequiredBadge')}
                </span>
              </div>
            )}

            {showInsuranceSummary && tulipInsurance?.mode === 'optional' && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('insuranceLineLabel')}
                </span>
                <span>
                  {estimatedInsuranceAmount > 0
                    ? formatMoney(estimatedInsuranceAmount, currency)
                    : tulipQuotePreview?.quoteUnavailable
                      ? t('insuranceOptionalUnavailableShort')
                      : tulipInsuranceOptIn
                        ? t('insuranceOptionalEnabled')
                        : t('insuranceOptionalDisabled')}
                </span>
              </div>
            )}

            {showInsuranceSummary &&
              (tulipQuotePreview?.insuredProductCount ?? 0) === 0 && (
                <p className="text-muted-foreground text-xs">
                  {t('insuranceNoInsurableProducts')}
                </p>
              )}

            {showInsuranceSummary &&
              (tulipQuotePreview?.insuredProductCount ?? 0) > 0 &&
              (tulipQuotePreview?.uninsuredProductCount ?? 0) > 0 && (
                <p className="text-muted-foreground text-xs">
                  {t('insurancePartialCoverage', {
                    insured: tulipQuotePreview?.insuredProductCount ?? 0,
                    uninsured: tulipQuotePreview?.uninsuredProductCount ?? 0,
                  })}
                </p>
              )}

            {showInsuranceSummary &&
              tulipQuotePreview?.quoteUnavailable &&
              tulipQuoteErrorMessage && (
                <Alert variant="warning">
                  <AlertDescription>{tulipQuoteErrorMessage}</AlertDescription>
                </Alert>
              )}

            {showInsuranceUi && isTulipQuoteLoading && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('insuranceLineLabel')}
                </span>
                <span className="text-muted-foreground animate-pulse">
                  {t('insuranceEstimating')}
                </span>
              </div>
            )}

            <Separator />
            <div className="flex justify-between text-lg font-semibold">
              <span>{tCart('total')}</span>
              <span className="text-primary">
                {formatMoney(totalWithEstimatedInsurance, currency)}
              </span>
            </div>

            {reservationMode === 'payment' && depositPercentage < 100 && (
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-base font-semibold">
                  <span>{t('toPayNow')}</span>
                  <span className="text-primary">
                    {formatMoney(
                      Math.round(
                        (subtotalWithEstimatedInsurance - discountAmount) *
                          depositPercentage,
                      ) / 100,
                      currency,
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('remainingAtPickup', {
                    amount: formatMoney(
                      Math.round(
                        (subtotalWithEstimatedInsurance - discountAmount) *
                          (100 - depositPercentage),
                      ) / 100,
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
                amount: formatMoney(totalSavings, currency),
              })}
            </div>
          )}

          {totalDeposit > 0 && reservationMode === 'payment' && (
            <div className="mt-2 space-y-2 border-t pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('depositLabel')}
                </span>
                <span className="font-medium">
                  {formatMoney(totalDeposit, currency)}
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
                  amount: formatMoney(totalDeposit, currency),
                })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
