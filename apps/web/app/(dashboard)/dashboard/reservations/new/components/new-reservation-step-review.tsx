'use client'

import { useEffect, useRef, useState } from 'react'

import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, MapPin, PenLine, Store, Truck, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
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
  subtotal: number
  deposit: number
  getProductPricingDetails: (
    product: Product,
    selectedItem?: SelectedProduct
  ) => ProductPricingDetails
  getCustomItemTotal: (item: CustomItem) => number
  onProductTotalChange: (
    lineId: string,
    totalPrice: number,
    pricing: ProductPricingDetails,
  ) => void
  onCustomItemTotalChange: (id: string, totalPrice: number) => void
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

function TotalPriceEditor({
  value,
  ariaLabel,
  onChange,
}: {
  value: number
  ariaLabel: string
  onChange: (value: number) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editStartValue, setEditStartValue] = useState(value)
  const [localValue, setLocalValue] = useState(value.toFixed(2))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocalValue(value.toFixed(2))
    }
  }, [value])

  if (!isEditing) {
    return (
      <div className="flex w-36 items-start justify-end gap-1">
        <span className="font-medium tabular-nums">
          {formatCurrency(value)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground h-7 w-7 shrink-0"
          aria-label={ariaLabel}
          onClick={() => {
            setEditStartValue(value)
            setLocalValue(value.toFixed(2))
            setIsEditing(true)
          }}
        >
          <PenLine className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative w-32">
      <Input
        ref={inputRef}
        inputMode="decimal"
        autoFocus
        value={localValue}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '' || /^\d*[.,]?\d{0,2}$/.test(raw)) {
            setLocalValue(raw)
            const parsed = parseFloat(raw.replace(',', '.'))
            if (!Number.isNaN(parsed)) {
              onChange(parsed)
            }
          }
        }}
        onBlur={() => {
          const parsed = parseFloat(localValue.replace(',', '.'))
          const final = Number.isNaN(parsed) ? 0 : parsed
          setLocalValue(final.toFixed(2))
          onChange(final)
          setIsEditing(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setLocalValue(editStartValue.toFixed(2))
            onChange(editStartValue)
            setIsEditing(false)
            return
          }

          if (event.key === 'Enter') {
            event.preventDefault()
            const parsed = parseFloat(localValue.replace(',', '.'))
            const final = Number.isNaN(parsed) ? 0 : parsed
            setLocalValue(final.toFixed(2))
            onChange(final)
            setIsEditing(false)
          }
        }}
        aria-label={ariaLabel}
        className="h-8 pr-8 text-right tabular-nums"
      />
      <span
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs"
        aria-hidden="true"
      >
        €
      </span>
    </div>
  )
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
  onProductTotalChange,
  onCustomItemTotalChange,
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

  const showDeliverySection = hasDeliveryLegs === true
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
                const isProductInsured =
                  isTulipInsuranceEnabledForReservation &&
                  product.tulipInsurable === true

                return (
                  <div key={item.lineId} className="flex items-start justify-between gap-3 p-3 text-sm">
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
                    <TotalPriceEditor
                      value={pricing.lineSubtotal}
                      ariaLabel={`${t('customItem.totalPrice')}, ${product.name}`}
                      onChange={(totalPrice) =>
                        onProductTotalChange(item.lineId, totalPrice, pricing)
                      }
                    />
                  </div>
                )
              })}
              {customItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 bg-muted/30 p-3 text-sm">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {t('customItem.badge')}
                    </Badge>
                    <span className="ml-2 text-muted-foreground">× {item.quantity}</span>
                  </div>
                  <TotalPriceEditor
                    value={getCustomItemTotal(item)}
                    ariaLabel={`${t('customItem.totalPrice')}, ${item.name}`}
                    onChange={(totalPrice) =>
                      onCustomItemTotalChange(item.id, totalPrice)
                    }
                  />
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
