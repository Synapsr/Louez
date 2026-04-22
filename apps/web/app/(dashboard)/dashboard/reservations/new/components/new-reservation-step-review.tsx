'use client'

import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, MapPin, Store, Truck, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import type { LegMethod } from '@louez/types'

import type {
  CustomItem,
  Customer,
  DeliveryAddress,
  NewReservationFormComponentApi,
  NewReservationFormValues,
  Product,
  ProductPricingDetails,
  SelectedProduct,
} from '../types'

interface DetailedDuration {
  days: number
  hours: number
  minutes: number
  totalHours: number
  totalMinutes: number
}

interface NewReservationStepReviewProps {
  form: NewReservationFormComponentApi
  customerType: NewReservationFormValues['customerType']
  selectedCustomer: Customer | undefined
  values: NewReservationFormValues
  startDate: Date | undefined
  endDate: Date | undefined
  duration: number
  detailedDuration: DetailedDuration | null
  locale: string
  dateLocale: Locale
  selectedProducts: SelectedProduct[]
  customItems: CustomItem[]
  products: Product[]
  tulipInsuranceMode: 'required' | 'optional' | 'no_public'
  tulipInsuranceOptIn: boolean
  tulipInsuranceAmount: number
  showTulipInsuranceSummary: boolean
  isTulipInsuranceLoading: boolean
  insuredProductCount: number | null
  uninsuredProductCount: number | null
  showTulipPastStartWarning: boolean
  tulipQuoteUnavailable: boolean
  tulipQuoteErrorMessage: string | null
  subtotal: number
  deposit: number
  getProductPricingDetails: (
    product: Product,
    selectedItem?: SelectedProduct
  ) => ProductPricingDetails
  getCustomItemTotal: (item: CustomItem) => number
  hasDeliveryLegs?: boolean
  deliveryFee?: number
  isDeliveryIncluded?: boolean
  outboundMethod?: LegMethod
  outboundAddress?: DeliveryAddress
  outboundDistance?: number | null
  returnMethod?: LegMethod
  returnAddress?: DeliveryAddress
  returnDistance?: number | null
  storeAddress?: string | null
}

export function NewReservationStepReview({
  form,
  customerType,
  selectedCustomer,
  values,
  startDate,
  endDate,
  duration,
  detailedDuration,
  locale,
  dateLocale,
  selectedProducts,
  customItems,
  products,
  tulipInsuranceMode,
  tulipInsuranceOptIn,
  tulipInsuranceAmount,
  showTulipInsuranceSummary,
  isTulipInsuranceLoading,
  insuredProductCount,
  uninsuredProductCount,
  showTulipPastStartWarning,
  tulipQuoteUnavailable,
  tulipQuoteErrorMessage,
  subtotal,
  deposit,
  getProductPricingDetails,
  getCustomItemTotal,
  hasDeliveryLegs,
  deliveryFee = 0,
  isDeliveryIncluded,
  outboundMethod = 'store',
  outboundAddress,
  outboundDistance,
  returnMethod = 'store',
  returnAddress,
  returnDistance,
  storeAddress,
}: NewReservationStepReviewProps) {
  const t = useTranslations('dashboard.reservations.manualForm')
  const tCheckout = useTranslations('storefront.checkout')

  const showDeliverySection = hasDeliveryLegs === true
  const total =
    subtotal +
    deliveryFee +
    (showTulipInsuranceSummary && tulipInsuranceOptIn ? tulipInsuranceAmount : 0)
  const isTulipInsuranceEnabledForReservation =
    tulipInsuranceMode === 'required' ||
    (tulipInsuranceMode === 'optional' && tulipInsuranceOptIn)
  const showOptionalTulipInsuranceDetails =
    tulipInsuranceMode === 'optional' &&
    (showTulipInsuranceSummary ||
      tulipQuoteUnavailable ||
      isTulipInsuranceLoading ||
      tulipInsuranceOptIn)
  const showOptionalTulipInsuranceAmountLine =
    showOptionalTulipInsuranceDetails &&
    (tulipQuoteUnavailable ||
      isTulipInsuranceLoading ||
      (insuredProductCount ?? 0) > 0 ||
      tulipInsuranceAmount > 0)
  const showTulipInsuranceCard = tulipInsuranceMode !== 'no_public'
  const insuranceStatusLabel = tulipQuoteUnavailable
    ? tCheckout('insuranceOptionalUnavailableShort')
    : tulipInsuranceOptIn
      ? tCheckout('insuranceOptionalEnabled')
      : tCheckout('insuranceOptionalDisabled')

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="h-5 w-5" />
            {t('confirmTitle')}
          </CardTitle>
          <CardDescription>{t('confirmDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="mb-2 text-sm font-medium">{t('customer')}</h4>
            <div className="rounded-lg border p-3">
              {customerType === 'existing' && selectedCustomer ? (
                <div>
                  <p className="font-medium">
                    {selectedCustomer.firstName} {selectedCustomer.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.email}</p>
                  {selectedCustomer.phone && (
                    <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="font-medium">
                    {values.firstName} {values.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">{values.email}</p>
                  {values.phone && <p className="text-sm text-muted-foreground">{values.phone}</p>}
                  <Badge variant="secondary" className="mt-2">
                    {t('newCustomerBadge')}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">{t('period')}</h4>
            <div className="rounded-lg border p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('startDate')}</span>
                <span>
                  {startDate &&
                    format(startDate, locale === 'fr' ? "PPP 'à' HH:mm" : "PPP 'at' HH:mm", {
                      locale: dateLocale,
                    })}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-muted-foreground">{t('endDate')}</span>
                <span>
                  {endDate &&
                    format(endDate, locale === 'fr' ? "PPP 'à' HH:mm" : "PPP 'at' HH:mm", {
                      locale: dateLocale,
                    })}
                </span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-sm font-medium">
                <span>{t('duration')}</span>
                <span>
                  {detailedDuration
                    ? [
                        detailedDuration.days > 0 && t('durationDays', { count: detailedDuration.days }),
                        detailedDuration.hours > 0 && t('durationHours', { count: detailedDuration.hours }),
                        detailedDuration.days === 0 && detailedDuration.hours === 0 && detailedDuration.minutes > 0 && `${detailedDuration.minutes} min`,
                      ].filter(Boolean).join(', ') || t('durationDays', { count: duration })
                    : t('durationDays', { count: duration })}
                </span>
              </div>
            </div>
            {showTulipPastStartWarning && (
              <Alert variant="warning" className="mt-3">
                <AlertDescription>
                  {t('tulipInsurance.pastStartWarning')}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Delivery section — per-leg detail */}
          {hasDeliveryLegs !== undefined && (
            <div>
              <h4 className="mb-2 text-sm font-medium">{t('deliveryTitle')}</h4>
              <div className="divide-y rounded-lg border">
                {/* Outbound leg */}
                <div className="p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('outboundLeg')}
                  </p>
                  <div className="flex items-center gap-2">
                    {outboundMethod === 'address' ? (
                      <Truck className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Store className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {outboundMethod === 'address' ? t('deliveryYes') : t('deliveryNo')}
                    </span>
                  </div>
                  {outboundMethod === 'address' && outboundAddress?.address && (
                    <p className="text-xs text-muted-foreground mt-1 ml-6 flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {outboundAddress.address}
                      {outboundDistance != null && ` (${outboundDistance.toFixed(1)} km)`}
                    </p>
                  )}
                  {outboundMethod === 'store' && storeAddress && (
                    <p className="text-xs text-muted-foreground mt-1 ml-6">{storeAddress}</p>
                  )}
                </div>

                {/* Return leg */}
                <div className="p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('returnLeg')}
                  </p>
                  <div className="flex items-center gap-2">
                    {returnMethod === 'address' ? (
                      <Truck className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Store className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {returnMethod === 'address' ? t('deliveryYes') : t('deliveryNo')}
                    </span>
                  </div>
                  {returnMethod === 'address' && returnAddress?.address && (
                    <p className="text-xs text-muted-foreground mt-1 ml-6 flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {returnAddress.address}
                      {returnDistance != null && ` (${returnDistance.toFixed(1)} km)`}
                    </p>
                  )}
                  {returnMethod === 'store' && storeAddress && (
                    <p className="text-xs text-muted-foreground mt-1 ml-6">{storeAddress}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-medium">
              {t('products')} ({selectedProducts.length + customItems.length})
            </h4>
            <div className="divide-y rounded-lg border">
              {selectedProducts.map((item) => {
                const product = products.find((p) => p.id === item.productId)
                if (!product) return null

                const pricing = getProductPricingDetails(product, item)
                const isProductTulipEligible =
                  isTulipInsuranceEnabledForReservation &&
                  product.tulipInsurable === true
                const productInsuranceBadgeLabel =
                  tulipInsuranceMode === 'required'
                    ? tCheckout('insuranceRequiredBadge')
                    : t('tulipInsurance.insurableProduct')

                return (
                  <div key={item.lineId} className="flex justify-between p-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{product.name}</span>
                        {isProductTulipEligible && (
                          <Badge
                            variant="outline"
                            className={
                              showTulipPastStartWarning
                                ? 'border-amber-300 bg-amber-50 text-amber-700'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            }
                          >
                            <Shield className="mr-1 h-3 w-3" />
                            {productInsuranceBadgeLabel}
                          </Badge>
                        )}
                        {pricing.hasPriceOverride && (
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-xs',
                              pricing.effectivePrice < pricing.calculatedPrice
                                ? 'bg-green-100 text-green-700'
                                : 'bg-orange-100 text-orange-700'
                            )}
                          >
                            {t('priceOverride.modified')}
                          </Badge>
                        )}
                        <span className="text-muted-foreground">× {item.quantity}</span>
                      </div>
                      {item.selectedAttributes && Object.keys(item.selectedAttributes).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(item.selectedAttributes)
                            .sort(([a], [b]) => a.localeCompare(b, 'en'))
                            .map(([key, value]) => (
                              <Badge key={`${item.lineId}-${key}`} variant="outline" className="text-xs">
                                {key}: {value}
                              </Badge>
                            ))}
                        </div>
                      )}
                    </div>
                    <span
                      className={
                        pricing.hasPriceOverride
                          ? pricing.effectivePrice < pricing.calculatedPrice
                            ? 'text-green-600'
                            : 'text-orange-600'
                          : ''
                      }
                    >
                      {formatCurrency(pricing.lineSubtotal)}
                    </span>
                  </div>
                )
              })}
              {customItems.map((item) => (
                <div key={item.id} className="flex justify-between bg-muted/30 p-3 text-sm">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {t('customItem.badge')}
                    </Badge>
                    <span className="ml-2 text-muted-foreground">× {item.quantity}</span>
                  </div>
                  <span>{formatCurrency(getCustomItemTotal(item))}</span>
                </div>
              ))}
              {showOptionalTulipInsuranceDetails && (
                <div className="flex justify-between bg-muted/30 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-emerald-600" />
                    <span className="font-medium">{tCheckout('insuranceLineLabel')}</span>
                    <Badge
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-emerald-700"
                    >
                      Tulip
                    </Badge>
                  </div>
                  <span>
                    {tulipQuoteUnavailable
                      ? tCheckout('insuranceOptionalUnavailableShort')
                      : tulipInsuranceOptIn
                      ? isTulipInsuranceLoading
                        ? t('insuranceEstimating')
                        : formatCurrency(tulipInsuranceAmount)
                      : tCheckout('insuranceOptionalDisabled')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('internalNotes')}</CardTitle>
            <CardDescription>{t('notesHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.AppField name="internalNotes">
              {(field) => (
                <field.Textarea
                  placeholder={t('notesPlaceholder')}
                  className="min-h-[120px] resize-none"
                />
              )}
            </form.AppField>
          </CardContent>
        </Card>

        {showTulipInsuranceCard && (
          <Card>
            <CardHeader>
              <CardTitle>{t('tulipInsurance.title')}</CardTitle>
              <CardDescription>{t('tulipInsurance.appliesMappedProducts')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tulipInsuranceMode === 'required' ? (
                showTulipPastStartWarning ? (
                  <Alert variant="warning">
                    <AlertDescription>{t('tulipInsurance.pastStartWarning')}</AlertDescription>
                  </Alert>
                ) : (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    {tCheckout('insuranceRequiredNotice')}
                  </div>
                )
              ) : (
                <>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{t('tulipInsurance.optionalLabel')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('tulipInsurance.optionalHelp')}
                        </p>
                      </div>
                      <Badge variant={tulipInsuranceOptIn ? 'default' : 'secondary'}>
                        {insuranceStatusLabel}
                      </Badge>
                    </div>
                    {showOptionalTulipInsuranceAmountLine && (
                      <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                        <span className="text-muted-foreground">
                          {tCheckout('insuranceLineLabel')}
                        </span>
                        <span className="font-medium">
                          {tulipQuoteUnavailable
                            ? tCheckout('insuranceOptionalUnavailableShort')
                            : tulipInsuranceOptIn
                              ? isTulipInsuranceLoading
                                ? tCheckout('insuranceEstimating')
                                : formatCurrency(tulipInsuranceAmount)
                              : tCheckout('insuranceOptionalDisabled')}
                        </span>
                      </div>
                    )}
                  </div>

                  {showOptionalTulipInsuranceDetails &&
                    insuredProductCount === 0 &&
                    uninsuredProductCount === 0 &&
                    !isTulipInsuranceLoading &&
                    !tulipQuoteUnavailable && (
                      <p className="text-xs text-muted-foreground">
                        {tCheckout('insuranceNoInsurableProducts')}
                      </p>
                    )}

                  {showOptionalTulipInsuranceDetails &&
                    (insuredProductCount ?? 0) > 0 &&
                    (uninsuredProductCount ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {tCheckout('insurancePartialCoverage', {
                          insured: insuredProductCount ?? 0,
                          uninsured: uninsuredProductCount ?? 0,
                        })}
                      </p>
                    )}

                  {tulipQuoteUnavailable && tulipQuoteErrorMessage && (
                    <Alert variant="warning">
                      <AlertDescription>{tulipQuoteErrorMessage}</AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('summary')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('subtotal')}</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {showDeliverySection && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('deliveryFee')}</span>
                <span className={isDeliveryIncluded || deliveryFee === 0 ? 'text-green-600' : ''}>
                  {isDeliveryIncluded
                    ? t('included')
                    : deliveryFee === 0
                      ? t('free')
                      : formatCurrency(deliveryFee)}
                </span>
              </div>
            )}
            {showOptionalTulipInsuranceAmountLine && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tCheckout('insuranceLineLabel')}</span>
                <span>
                  {tulipQuoteUnavailable
                    ? tCheckout('insuranceOptionalUnavailableShort')
                    : tulipInsuranceOptIn
                    ? isTulipInsuranceLoading
                      ? tCheckout('insuranceEstimating')
                      : formatCurrency(tulipInsuranceAmount)
                    : tCheckout('insuranceOptionalDisabled')}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('deposit')}</span>
              <span>{formatCurrency(deposit)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>{t('total')}</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
