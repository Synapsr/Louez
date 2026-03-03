'use client'

import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, MapPin, Truck, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import type {
  CustomItem,
  Customer,
  DeliveryAddress,
  DeliveryOption,
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
  subtotal: number
  deposit: number
  getProductPricingDetails: (
    product: Product,
    selectedItem?: SelectedProduct
  ) => ProductPricingDetails
  getCustomItemTotal: (item: CustomItem) => number
  deliveryOption?: DeliveryOption
  deliveryAddress?: DeliveryAddress
  deliveryFee?: number
  deliveryDistance?: number | null
  isDeliveryIncluded?: boolean
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
  subtotal,
  deposit,
  getProductPricingDetails,
  getCustomItemTotal,
  deliveryOption,
  deliveryAddress,
  deliveryFee = 0,
  deliveryDistance,
  isDeliveryIncluded,
}: NewReservationStepReviewProps) {
  const t = useTranslations('dashboard.reservations.manualForm')

  const showDeliverySection = deliveryOption === 'delivery'
  const total = subtotal + deliveryFee
  const isTulipInsuranceEnabledForReservation =
    tulipInsuranceMode === 'required' ||
    (tulipInsuranceMode === 'optional' && tulipInsuranceOptIn)

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
          </div>

          {/* Delivery section */}
          {showDeliverySection && deliveryAddress && (
            <div>
              <h4 className="mb-2 text-sm font-medium">{t('deliveryTitle')}</h4>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('deliveryOptionLabel')}</span>
                </div>
                {deliveryAddress.address && (
                  <p className="text-sm text-muted-foreground">
                    {deliveryAddress.address}
                  </p>
                )}
                {deliveryDistance != null && (
                  <p className="text-sm text-muted-foreground">
                    {deliveryDistance.toFixed(1)} km
                  </p>
                )}
              </div>
            </div>
          )}

          {deliveryOption === 'pickup' && deliveryOption !== undefined && (
            <div>
              <h4 className="mb-2 text-sm font-medium">{t('deliveryTitle')}</h4>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('deliveryNo')}</span>
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
                const isProductInsured =
                  isTulipInsuranceEnabledForReservation &&
                  product.tulipInsurable === true

                return (
                  <div key={item.lineId} className="flex justify-between p-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{product.name}</span>
                        {isProductInsured && (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 bg-emerald-50 text-emerald-700"
                          >
                            <Shield className="mr-1 h-3 w-3" />
                            {t('tulipInsurance.assuredProduct')}
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
