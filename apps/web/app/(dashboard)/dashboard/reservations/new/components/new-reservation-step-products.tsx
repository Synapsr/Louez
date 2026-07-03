'use client';

import { useMemo, useState } from 'react';

import {
  AlertTriangle,
  ImageIcon,
  Loader2,
  Minus,
  Package,
  PackageX,
  PenLine,
  Plus,
  Shield,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PricingMode } from '@louez/types';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@louez/ui';
import { cn, formatCurrency, minutesToPriceDuration } from '@louez/utils';

import { SearchInput } from '@/components/ui/search-input';

import type { PeriodAvailability } from '../hooks/use-new-reservation-warnings';
import type {
  AvailabilityWarning,
  CustomItem,
  Product,
  ProductPricingDetails,
  SelectedProduct,
} from '../types';
import {
  buildProductCombinations,
  getLineQuantityConstraints,
} from '../utils/variant-lines';

interface NewReservationStepProductsProps {
  products: Product[];
  selectedProducts: SelectedProduct[];
  customItems: CustomItem[];
  tulipInsuranceMode: 'required' | 'optional' | 'no_public';
  tulipInsuranceOptIn: boolean;
  tulipInsuranceAmount: number;
  isTulipInsuranceQuoteLoading: boolean;
  tulipInsuranceQuoteErrorMessage: string | null;
  startDate: Date | undefined;
  endDate: Date | undefined;
  availabilityWarnings: AvailabilityWarning[];
  periodAvailability: PeriodAvailability;
  hasSelectedPeriod: boolean;
  hasItems: boolean;
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  deposit: number;
  addProduct: (productId: string) => void;
  updateQuantity: (lineId: string, delta: number) => void;
  updateSelectedAttributes: (
    lineId: string,
    axisKey: string,
    value: string | undefined,
  ) => void;
  removeSelectedProductLine: (lineId: string) => void;
  onOpenCustomItemDialog: () => void;
  updateCustomItemQuantity: (id: string, delta: number) => void;
  removeCustomItem: (id: string) => void;
  onTulipInsuranceOptInChange: (value: boolean) => void;
  openPriceOverrideDialog: (
    lineId: string,
    calculatedPrice: number,
    pricingMode: PricingMode,
    duration: number,
  ) => void;
  calculateDurationForMode: (
    startDate: Date,
    endDate: Date,
    mode: PricingMode,
  ) => number;
  getProductPricingDetails: (
    product: Product,
    selectedItem?: SelectedProduct,
  ) => ProductPricingDetails;
  getCustomItemTotal: (item: CustomItem) => number;
}

export function NewReservationStepProducts({
  products,
  selectedProducts,
  customItems,
  tulipInsuranceMode,
  tulipInsuranceOptIn,
  tulipInsuranceAmount,
  isTulipInsuranceQuoteLoading,
  tulipInsuranceQuoteErrorMessage,
  startDate,
  endDate,
  availabilityWarnings,
  periodAvailability,
  hasSelectedPeriod,
  hasItems,
  subtotal,
  originalSubtotal,
  totalSavings,
  deposit,
  addProduct,
  updateQuantity,
  updateSelectedAttributes,
  removeSelectedProductLine,
  onOpenCustomItemDialog,
  updateCustomItemQuantity,
  removeCustomItem,
  onTulipInsuranceOptInChange,
  openPriceOverrideDialog,
  calculateDurationForMode,
  getProductPricingDetails,
  getCustomItemTotal,
}: NewReservationStepProductsProps) {
  const t = useTranslations('dashboard.reservations.manualForm');
  const tCommon = useTranslations('common');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const isTulipInsuranceEnabledForReservation =
    tulipInsuranceMode === 'required' ||
    (tulipInsuranceMode === 'optional' && tulipInsuranceOptIn);
  const visibleTulipInsuranceAmount = isTulipInsuranceEnabledForReservation
    ? tulipInsuranceAmount
    : 0;
  const totalWithInsurance = subtotal + visibleTulipInsuranceAmount;

  const normalizedProductSearchQuery = productSearchQuery.trim().toLowerCase();
  const filteredProducts = useMemo(() => {
    if (!normalizedProductSearchQuery) {
      return products;
    }

    return products.filter((product) => {
      const searchableText = [
        product.name,
        product.description,
        ...(product.bookingAttributeAxes || []).flatMap((axis) => [
          axis.key,
          axis.label,
        ]),
        ...product.units.flatMap((unit) =>
          Object.values(unit.attributes || {}),
        ),
      ]
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        )
        .join(' ')
        .toLowerCase();

      return searchableText.includes(normalizedProductSearchQuery);
    });
  }, [normalizedProductSearchQuery, products]);

  const getPricingUnitLabel = (mode: PricingMode) => {
    if (mode === 'hour') return t('perHour');
    if (mode === 'week') return t('perWeek');
    return t('perDay');
  };

  const getDurationLabel = (mode: PricingMode, count: number) => {
    if (mode === 'hour') return tCommon('hourUnit', { count });
    if (mode === 'week') return tCommon('weekUnit', { count });
    return tCommon('dayUnit', { count });
  };

  const formatPeriodLabel = (periodMinutes: number) => {
    const period = minutesToPriceDuration(periodMinutes);
    if (period.unit === 'minute') return `${period.duration} min`;
    if (period.duration === 1)
      return getPricingUnitLabel(period.unit as PricingMode);
    return `${period.duration} ${getDurationLabel(period.unit as PricingMode, period.duration)}`;
  };

  const getProductPeriodLabel = (product: Product, mode: PricingMode) => {
    if (product.basePeriodMinutes && product.basePeriodMinutes > 0) {
      return formatPeriodLabel(product.basePeriodMinutes);
    }
    return getPricingUnitLabel(mode);
  };

  const formatRatePlanBreakdown = (
    plan: Array<{ rate: { period: number; price: number }; quantity: number }>,
    lineSubtotal?: number,
  ) => {
    if (plan.length === 1) {
      const entry = plan[0];
      const periodLabel = formatPeriodLabel(entry.rate.period);
      // Show the applied tier period and the actual charged amount
      return `${periodLabel} · ${formatCurrency(lineSubtotal ?? entry.rate.price)}`;
    }
    return plan
      .sort((a, b) => b.rate.period - a.rate.period)
      .map((entry) => {
        const periodLabel = formatPeriodLabel(entry.rate.period);
        const price = entry.rate.price * entry.quantity;
        const qtyPrefix = entry.quantity > 1 ? `${entry.quantity}× ` : '';
        return `${qtyPrefix}${periodLabel} · ${formatCurrency(price)}`;
      })
      .join(' + ');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t('products')}
        </CardTitle>
        <CardDescription>{t('productsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {products.length > 0 && (
          <SearchInput
            autoFocus
            value={productSearchQuery}
            onChange={(event) => setProductSearchQuery(event.target.value)}
            onClear={() => setProductSearchQuery('')}
            placeholder={t('searchProductsPlaceholder', {
              count: products.length,
            })}
            clearLabel={t('clearProductSearch')}
            groupClassName="h-10 w-full min-w-0"
            className="min-w-0"
          />
        )}

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {filteredProducts.map((product) => {
            const productLines = selectedProducts.filter(
              (line) => line.productId === product.id,
            );
            const selectedQuantity = productLines.reduce(
              (sum, line) => sum + line.quantity,
              0,
            );
            const productReservedQuantity =
              periodAvailability.reservedByProduct.get(product.id) || 0;
            const periodProductAvailability =
              periodAvailability.productsById.get(product.id);
            const productCombinations = buildProductCombinations(
              product,
              periodAvailability.reservedByProductCombination,
              hasSelectedPeriod,
              periodProductAvailability,
            );
            const productCapacity = product.trackUnits
              ? (periodProductAvailability?.availableQuantity ??
                productCombinations.reduce(
                  (sum, combination) =>
                    sum + Math.max(0, combination.availableQuantity || 0),
                  0,
                ))
              : (periodProductAvailability?.availableQuantity ??
                Math.max(0, product.quantity - productReservedQuantity));
            const isOutOfStock = productCapacity === 0;
            const remainingStock = Math.max(
              0,
              productCapacity - selectedQuantity,
            );
            const bookingAttributeAxes = (product.bookingAttributeAxes || [])
              .slice()
              .sort((a, b) => a.position - b.position);
            const hasBookingAttributes =
              product.trackUnits && bookingAttributeAxes.length > 0;
            const bookingAttributeValues = bookingAttributeAxes.reduce<
              Record<string, string[]>
            >((acc, axis) => {
              const values = new Set<string>();
              if (hasSelectedPeriod && periodProductAvailability) {
                for (const combination of productCombinations) {
                  if (combination.availableQuantity <= 0) {
                    continue;
                  }
                  const rawValue = combination.selectedAttributes?.[axis.key];
                  if (rawValue && rawValue.trim()) {
                    values.add(rawValue.trim());
                  }
                }
              } else {
                for (const unit of product.units || []) {
                  if ((unit.lifecycleStatus || 'active') !== 'active') {
                    continue;
                  }
                  if (unit.inDowntimeNow) {
                    continue;
                  }
                  const rawValue = unit.attributes?.[axis.key];
                  if (rawValue && rawValue.trim()) {
                    values.add(rawValue.trim());
                  }
                }
              }
              for (const line of productLines) {
                const selectedValue = line.selectedAttributes?.[axis.key];
                if (selectedValue && selectedValue.trim()) {
                  values.add(selectedValue.trim());
                }
              }
              acc[axis.key] = [...values].sort((a, b) =>
                a.localeCompare(b, 'en'),
              );
              return acc;
            }, {});

            const summaryPricing = getProductPricingDetails(
              product,
              productLines[0],
            );
            const {
              productPricingMode,
              basePrice,
              hasDiscount,
              applicableTierDiscountPercent,
              hasTieredPricing,
              reductionPercent,
            } = summaryPricing;
            const discountDisplay =
              applicableTierDiscountPercent ?? reductionPercent;

            const lineStates = productLines.map((line) => {
              const pricing = getProductPricingDetails(product, line);
              const constraints = getLineQuantityConstraints(
                product,
                line,
                productLines,
                productReservedQuantity,
                periodAvailability.reservedByProductCombination,
                hasSelectedPeriod,
                periodProductAvailability,
              );

              return {
                line,
                pricing,
                constraints,
              };
            });
            const hasFullSelectionLine = lineStates.some(
              (lineState) => lineState.constraints.selectionMode === 'full',
            );

            return (
              <div
                key={product.id}
                className={cn(
                  'min-w-0 rounded-lg border p-3 transition-colors sm:p-4',
                  isOutOfStock && 'bg-muted/30 opacity-60',
                  selectedQuantity > 0 && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="bg-muted relative h-10 w-10 shrink-0 overflow-hidden rounded-md sm:h-12 sm:w-12">
                      {product.images && product.images.length > 0 ? (
                        // Product thumbnails already use direct URLs in this feature.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.images[0]}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="text-muted-foreground h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm leading-tight font-medium sm:text-base">
                          {product.name}
                        </p>
                        {product.tulipInsurable && (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-emerald-300 bg-emerald-50 text-emerald-700"
                          >
                            <Shield className="mr-1 h-3 w-3" />
                            {t('tulipInsurance.insurableProduct')}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5">
                        {summaryPricing.productDuration > 0 ? (
                          <>
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-primary text-sm font-semibold">
                                {formatCurrency(summaryPricing.lineSubtotal)}
                              </span>
                              {summaryPricing.lineSavings > 0 && (
                                <>
                                  <span className="text-muted-foreground text-xs line-through">
                                    {formatCurrency(
                                      summaryPricing.lineOriginalSubtotal,
                                    )}
                                  </span>
                                  {discountDisplay != null &&
                                    discountDisplay > 0 && (
                                      <Badge
                                        variant="success"
                                        className="text-xs"
                                      >
                                        -{Math.floor(discountDisplay)}%
                                      </Badge>
                                    )}
                                </>
                              )}
                            </div>
                            <p className="text-muted-foreground text-xs break-words">
                              {summaryPricing.isRateBased &&
                              summaryPricing.ratePlan &&
                              summaryPricing.ratePlan.length > 0
                                ? formatRatePlanBreakdown(
                                    summaryPricing.ratePlan,
                                    summaryPricing.lineSubtotal,
                                  )
                                : `${formatCurrency(basePrice)}/${getProductPeriodLabel(product, productPricingMode)}`}
                            </p>
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-muted-foreground text-sm">
                              {formatCurrency(basePrice)}/
                              {getProductPeriodLabel(
                                product,
                                productPricingMode,
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {isOutOfStock ? (
                          <Badge variant="error" className="text-xs">
                            {t('outOfStock')}
                          </Badge>
                        ) : (
                          <span
                            className={cn(
                              'text-xs',
                              remainingStock <= 2
                                ? 'text-orange-600'
                                : 'text-muted-foreground',
                            )}
                          >
                            {remainingStock} {t('available')}
                          </span>
                        )}
                        {hasTieredPricing && !hasDiscount && (
                          <span className="text-muted-foreground text-xs">
                            • {t('tieredPricing')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                    {productLines.length === 0 ? (
                      <Button
                        type="button"
                        variant={isOutOfStock ? 'ghost' : 'outline'}
                        onClick={() => addProduct(product.id)}
                        disabled={isOutOfStock}
                        className="w-full sm:w-auto"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        {t('add')}
                      </Button>
                    ) : hasBookingAttributes ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => addProduct(product.id)}
                        disabled={remainingStock <= 0}
                        className="w-full sm:w-auto"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        {t('addOptionLine')}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {productLines.length > 0 &&
                  summaryPricing.productDuration > 0 && (
                    <div className="mt-3 space-y-3 border-t pt-3">
                      {lineStates.map(
                        ({ line, pricing, constraints }, index) => {
                          const lineMaxQuantity = constraints.lineMaxQuantity;
                          const canIncreaseLine =
                            line.quantity < lineMaxQuantity;
                          const lineReachedMax =
                            lineMaxQuantity > 0 &&
                            line.quantity >= lineMaxQuantity;

                          return (
                            <div
                              key={line.lineId}
                              className="bg-background/70 space-y-3 rounded-md border p-3"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-muted-foreground text-xs font-medium">
                                    {t('lineLabel', { index: index + 1 })}
                                  </span>
                                  {line.selectedAttributes &&
                                    Object.entries(line.selectedAttributes)
                                      .sort(([a], [b]) =>
                                        a.localeCompare(b, 'en'),
                                      )
                                      .map(([key, value]) => (
                                        <Badge
                                          key={`${line.lineId}-${key}`}
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {key}: {value}
                                        </Badge>
                                      ))}
                                </div>
                                <div className="flex items-center gap-1 self-start sm:self-auto">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() =>
                                      updateQuantity(line.lineId, -1)
                                    }
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <span className="w-8 text-center font-medium">
                                    {line.quantity}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() =>
                                      updateQuantity(line.lineId, 1)
                                    }
                                    disabled={!canIncreaseLine}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive h-8 w-8"
                                    onClick={() =>
                                      removeSelectedProductLine(line.lineId)
                                    }
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>

                              {hasBookingAttributes && (
                                <div className="space-y-2">
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {bookingAttributeAxes.map((axis) => (
                                      <Select
                                        key={`${line.lineId}-${axis.key}`}
                                        value={
                                          line.selectedAttributes?.[axis.key] ||
                                          '__none__'
                                        }
                                        onValueChange={(value) =>
                                          updateSelectedAttributes(
                                            line.lineId,
                                            axis.key,
                                            value && value !== '__none__'
                                              ? value
                                              : undefined,
                                          )
                                        }
                                      >
                                        <SelectTrigger className="h-8">
                                          <SelectValue placeholder={axis.label}>
                                            {line.selectedAttributes?.[
                                              axis.key
                                            ] || axis.label}
                                          </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem
                                            value="__none__"
                                            label={t('bookingAttributeNone')}
                                          >
                                            {t('bookingAttributeNone')}
                                          </SelectItem>
                                          {(
                                            bookingAttributeValues[axis.key] ||
                                            []
                                          ).length > 0 ? (
                                            (
                                              bookingAttributeValues[
                                                axis.key
                                              ] || []
                                            ).map((value) => (
                                              <SelectItem
                                                key={value}
                                                value={value}
                                                label={value}
                                              >
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
                                    {t('availableForSelection', {
                                      count: lineMaxQuantity,
                                    })}
                                  </p>
                                </div>
                              )}

                              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="text-muted-foreground min-w-0 break-words">
                                    {pricing.isRateBased &&
                                    pricing.ratePlan &&
                                    pricing.ratePlan.length > 0 ? (
                                      <>
                                        {line.quantity > 1 &&
                                          `${line.quantity} × `}
                                        {formatRatePlanBreakdown(
                                          pricing.ratePlan,
                                          pricing.lineSubtotal /
                                            Math.max(1, line.quantity),
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        {line.quantity} ×{' '}
                                        {pricing.productDuration}{' '}
                                        {getDurationLabel(
                                          pricing.productPricingMode,
                                          pricing.productDuration,
                                        )}
                                      </>
                                    )}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
                                    onClick={() =>
                                      openPriceOverrideDialog(
                                        line.lineId,
                                        pricing.calculatedPrice,
                                        pricing.productPricingMode,
                                        pricing.productDuration,
                                      )
                                    }
                                  >
                                    <PenLine className="h-3 w-3" />
                                  </Button>
                                </div>
                                <div className="text-left sm:text-right">
                                  {pricing.hasPriceOverride ? (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-muted-foreground text-xs line-through">
                                        {formatCurrency(
                                          pricing.calculatedPrice *
                                            line.quantity *
                                            pricing.productDuration,
                                        )}
                                      </span>
                                      <span
                                        className={cn(
                                          'font-medium',
                                          pricing.effectivePrice <
                                            pricing.calculatedPrice
                                            ? 'text-green-600'
                                            : 'text-orange-600',
                                        )}
                                      >
                                        {formatCurrency(pricing.lineSubtotal)}
                                      </span>
                                    </div>
                                  ) : pricing.hasDiscount ? (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-muted-foreground text-xs line-through">
                                        {formatCurrency(
                                          pricing.lineOriginalSubtotal,
                                        )}
                                      </span>
                                      <span className="font-medium text-green-600">
                                        {formatCurrency(pricing.lineSubtotal)}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="font-medium">
                                      {formatCurrency(pricing.lineSubtotal)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {lineReachedMax && (
                                <p className="text-xs text-amber-600">
                                  {t('lineMaxReached')}
                                </p>
                              )}
                            </div>
                          );
                        },
                      )}

                      {hasBookingAttributes && (
                        <p className="text-muted-foreground text-xs">
                          {hasFullSelectionLine
                            ? t('quantityPerCombinationHint')
                            : t('quantityCanSplitHint')}
                        </p>
                      )}
                    </div>
                  )}
              </div>
            );
          })}
        </div>

        {products.length > 0 && filteredProducts.length === 0 && (
          <div className="py-8 text-center">
            <PackageX className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <p className="text-muted-foreground">{t('noProductsFound')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('noProductsFoundHint', { search: productSearchQuery.trim() })}
            </p>
          </div>
        )}

        {products.length === 0 && customItems.length === 0 && (
          <div className="py-8 text-center">
            <ShoppingCart className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <p className="text-muted-foreground">{t('noProducts')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('noProductsHint')}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <PenLine className="h-4 w-4" />
              {t('customItem.title')}
            </h4>
            <Button
              type="button"
              variant="outline"
              onClick={onOpenCustomItemDialog}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('customItem.add')}
            </Button>
          </div>

          {customItems.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {customItems.map((item) => (
                <div
                  key={item.id}
                  className="border-primary/30 bg-primary/5 rounded-lg border border-dashed p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{item.name}</p>
                        <Badge variant="secondary" className="text-xs">
                          {t('customItem.badge')}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {formatCurrency(item.unitPrice)}/
                        {item.pricingMode === 'hour'
                          ? t('perHour')
                          : item.pricingMode === 'week'
                            ? 'week'
                            : t('perDay')}
                      </p>
                      {item.description && (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCustomItemQuantity(item.id, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center font-medium">
                        {item.quantity}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCustomItemQuantity(item.id, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive h-8 w-8"
                        onClick={() => removeCustomItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {startDate && endDate && (
                    <div className="border-border mt-3 flex items-center justify-between border-t pt-3 text-sm">
                      <span className="text-muted-foreground">
                        {item.quantity} ×{' '}
                        {calculateDurationForMode(
                          startDate,
                          endDate,
                          item.pricingMode,
                        )}{' '}
                        {item.pricingMode === 'hour'
                          ? 'h'
                          : item.pricingMode === 'week'
                            ? 'sem'
                            : 'j'}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(getCustomItemTotal(item))}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {customItems.length === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed py-4 text-center text-sm">
              {t('customItem.empty')}
            </p>
          )}
        </div>

        {availabilityWarnings.length > 0 && (
          <div className="space-y-2">
            {availabilityWarnings.map((warning) => (
              <Alert
                key={warning.productId}
                className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
              >
                <PackageX className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                <AlertDescription className="ml-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-amber-800 dark:text-amber-200">
                      {t('warnings.productConflict', {
                        name: warning.productName,
                      })}
                    </span>
                    <span className="text-sm text-amber-700 dark:text-amber-300">
                      {t('warnings.productConflictDetails', {
                        requested: warning.requestedQuantity,
                        available: warning.availableQuantity,
                      })}
                    </span>
                    {(warning.turnoverBufferMinutes ?? 0) > 0 && (
                      <span className="text-sm text-amber-700 dark:text-amber-300">
                        {t('warnings.turnoverBufferConflictDetails', {
                          duration: warning.turnoverBufferMinutes ?? 0,
                        })}
                      </span>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            ))}
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />
              {t('warnings.conflictCanContinue')}
            </p>
          </div>
        )}

        {hasItems && (
          <div className="space-y-3">
            <div className="bg-muted/50 space-y-2 rounded-lg p-4">
              {totalSavings > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('originalPrice')}
                  </span>
                  <span className="text-muted-foreground line-through">
                    {formatCurrency(originalSubtotal)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('subtotal')}</span>
                <span
                  className={
                    totalSavings > 0 ? 'font-medium text-green-600' : ''
                  }
                >
                  {formatCurrency(subtotal)}
                </span>
              </div>
              {totalSavings > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">{t('totalSavings')}</span>
                  <span className="font-medium text-green-600">
                    -{formatCurrency(totalSavings)}
                  </span>
                </div>
              )}
              {isTulipInsuranceEnabledForReservation &&
                (visibleTulipInsuranceAmount > 0 ||
                  isTulipInsuranceQuoteLoading) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('tulipInsurance.title')}
                    </span>
                    <span className="font-medium">
                      {isTulipInsuranceQuoteLoading
                        ? t('tulipInsurance.calculating')
                        : formatCurrency(visibleTulipInsuranceAmount)}
                    </span>
                  </div>
                )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('deposit')}</span>
                <span>{formatCurrency(deposit)}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-medium">
                <span>{t('total')}</span>
                <span>{formatCurrency(totalWithInsurance)}</span>
              </div>
            </div>

            {tulipInsuranceMode !== 'no_public' && (
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">
                  {t('tulipInsurance.title')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('tulipInsurance.appliesMappedProducts')}
                </p>

                {tulipInsuranceMode === 'required' ? (
                  <p className="mt-3 text-sm font-medium text-emerald-700">
                    {t('tulipInsurance.required')}
                  </p>
                ) : (
                  <div className="mt-3 flex items-center space-x-2">
                    <Checkbox
                      id="manual-form-tulip-insurance-opt-in"
                      checked={tulipInsuranceOptIn}
                      onCheckedChange={(checked) =>
                        onTulipInsuranceOptInChange(checked === true)
                      }
                    />
                    <label
                      htmlFor="manual-form-tulip-insurance-opt-in"
                      className="cursor-pointer text-sm"
                    >
                      {t('tulipInsurance.optionalLabel')}
                    </label>
                  </div>
                )}

                {isTulipInsuranceEnabledForReservation && (
                  <div className="mt-3 space-y-2">
                    {isTulipInsuranceQuoteLoading ? (
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{t('tulipInsurance.calculating')}</span>
                      </div>
                    ) : visibleTulipInsuranceAmount > 0 ? (
                      <p className="text-muted-foreground text-xs font-medium">
                        {t('tulipInsurance.estimatedAmount', {
                          amount: formatCurrency(visibleTulipInsuranceAmount),
                        })}
                      </p>
                    ) : null}

                    {tulipInsuranceQuoteErrorMessage && (
                      <Alert variant="warning">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="ml-2 text-xs">
                          {t('tulipInsurance.previewUnavailable')}{' '}
                          {tulipInsuranceQuoteErrorMessage}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
