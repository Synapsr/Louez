'use client'

import { MapPin, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { DeliverySettings } from '@louez/types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
} from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import { AddressInput } from '@/components/ui/address-input'
import { isFreeDelivery } from '@/lib/utils/geo'

import type { DeliveryAddress, DeliveryOption } from '../types'

interface NewReservationStepDeliveryProps {
  deliverySettings: DeliverySettings
  deliveryOption: DeliveryOption
  deliveryAddress: DeliveryAddress
  deliveryDistance: number | null
  deliveryFee: number
  deliveryError: string | null
  subtotal: number
  storeAddress?: string | null
  isDeliveryForced: boolean
  isDeliveryIncluded: boolean
  allowDifferentReturnAddress: boolean
  hasDifferentReturnAddress: boolean
  returnAddress: DeliveryAddress
  returnDistance: number | null
  returnError: string | null
  onDeliveryOptionChange: (option: DeliveryOption) => void
  onDeliveryAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void
  onDifferentReturnAddressToggle: (checked: boolean) => void
  onReturnAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void
}

export function NewReservationStepDelivery({
  deliverySettings,
  deliveryOption,
  deliveryAddress,
  deliveryDistance,
  deliveryFee,
  deliveryError,
  subtotal,
  storeAddress,
  isDeliveryForced,
  isDeliveryIncluded,
  allowDifferentReturnAddress,
  hasDifferentReturnAddress,
  returnAddress,
  returnDistance,
  returnError,
  onDeliveryOptionChange,
  onDeliveryAddressChange,
  onDifferentReturnAddressToggle,
  onReturnAddressChange,
}: NewReservationStepDeliveryProps) {
  const t = useTranslations('dashboard.reservations.manualForm')

  const shouldShowDeliveryForm =
    deliveryOption === 'delivery' || isDeliveryForced

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5" />
          {t('deliveryTitle')}
        </CardTitle>
        <CardDescription>{t('deliveryStepDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Binary choice: delivery or pickup */}
        {!isDeliveryForced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onDeliveryOptionChange('delivery')}
              className={cn(
                'flex flex-col items-center gap-3 rounded-xl border-2 p-6 text-center transition-all',
                deliveryOption === 'delivery'
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
              )}
            >
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full',
                  deliveryOption === 'delivery'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <Truck className="h-6 w-6" />
              </div>
              <span className="text-lg font-semibold">{t('deliveryYes')}</span>
              <span className="text-muted-foreground text-sm">
                {t('deliveryYesDescription')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onDeliveryOptionChange('pickup')}
              className={cn(
                'flex flex-col items-center gap-3 rounded-xl border-2 p-6 text-center transition-all',
                deliveryOption === 'pickup'
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
              )}
            >
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full',
                  deliveryOption === 'pickup'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <MapPin className="h-6 w-6" />
              </div>
              <span className="text-lg font-semibold">{t('deliveryNo')}</span>
              <span className="text-muted-foreground text-sm">
                {t('deliveryNoDescription')}
              </span>
              {storeAddress && (
                <span className="text-muted-foreground text-xs">
                  {storeAddress}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Forced delivery info banner */}
        {isDeliveryForced && (
          <div
            className={cn(
              'flex items-start gap-3 rounded-lg p-4',
              isDeliveryIncluded
                ? 'bg-green-50 dark:bg-green-950/30'
                : 'bg-blue-50 dark:bg-blue-950/30',
            )}
          >
            <Truck
              className={cn(
                'mt-0.5 h-5 w-5 shrink-0',
                isDeliveryIncluded
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-blue-600 dark:text-blue-400',
              )}
            />
            <div>
              <p
                className={cn(
                  'font-medium',
                  isDeliveryIncluded
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-blue-700 dark:text-blue-300',
                )}
              >
                {isDeliveryIncluded
                  ? t('deliveryIncludedBanner')
                  : t('deliveryRequiredBanner')}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-sm',
                  isDeliveryIncluded
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-blue-600 dark:text-blue-400',
                )}
              >
                {isDeliveryIncluded
                  ? t('deliveryIncludedNote')
                  : t('deliveryRequiredNote')}
              </p>
            </div>
          </div>
        )}

        {/* Delivery address form */}
        {shouldShowDeliveryForm && (
          <div
            className={cn('space-y-4', !isDeliveryForced && 'border-t pt-6')}
          >
            {/* Delivery address input */}
            <div>
              <label className="text-sm font-medium">
                {t('deliveryAddress')}
              </label>
              <div className="mt-2">
                <AddressInput
                  value={deliveryAddress.address}
                  latitude={deliveryAddress.latitude}
                  longitude={deliveryAddress.longitude}
                  onChange={onDeliveryAddressChange}
                  placeholder={t('deliveryAddressPlaceholder')}
                />
              </div>
            </div>

            {/* Distance & fee summary */}
            {deliveryDistance !== null && !deliveryError && (
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex justify-between text-sm">
                  <span>{t('deliveryDistance')}</span>
                  <span>{deliveryDistance.toFixed(1)} km</span>
                </div>
                {hasDifferentReturnAddress &&
                  returnDistance !== null &&
                  !returnError && (
                    <div className="mt-1 flex justify-between text-sm">
                      <span>{t('returnDistance')}</span>
                      <span>{returnDistance.toFixed(1)} km</span>
                    </div>
                  )}
                {!isDeliveryIncluded && (
                  <div className="mt-2 flex justify-between font-medium">
                    <span>{t('deliveryFee')}</span>
                    <span
                      className={deliveryFee === 0 ? 'text-green-600' : ''}
                    >
                      {deliveryFee === 0
                        ? t('free')
                        : formatCurrency(deliveryFee)}
                    </span>
                  </div>
                )}
                {isDeliveryIncluded && (
                  <div className="mt-2 flex justify-between font-medium text-green-600">
                    <span>{t('deliveryFee')}</span>
                    <span>{t('included')}</span>
                  </div>
                )}
                {deliveryFee === 0 &&
                  !isDeliveryIncluded &&
                  deliverySettings.freeDeliveryThreshold &&
                  isFreeDelivery(subtotal, deliverySettings) && (
                    <p className="mt-1 text-xs text-green-600">
                      {t('freeDeliveryApplied')}
                    </p>
                  )}
                {deliverySettings.roundTrip && !isDeliveryIncluded && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {hasDifferentReturnAddress &&
                    returnDistance !== null &&
                    !returnError
                      ? t('roundTripNoteDifferentReturn', {
                          deliveryKm: deliveryDistance.toFixed(1),
                          returnKm: returnDistance.toFixed(1),
                          total: (deliveryDistance + returnDistance).toFixed(1),
                        })
                      : t('roundTripNote', {
                          distance: deliveryDistance.toFixed(1),
                          total: (deliveryDistance * 2).toFixed(1),
                        })}
                  </p>
                )}
              </div>
            )}

            {/* Delivery error */}
            {deliveryError && (
              <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">
                {deliveryError}
              </div>
            )}

            {/* Different return address option */}
            {allowDifferentReturnAddress && (
              <div className="space-y-4 border-t pt-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={hasDifferentReturnAddress}
                    onCheckedChange={(checked) =>
                      onDifferentReturnAddressToggle(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">
                      {t('differentReturnAddress')}
                    </span>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t('differentReturnAddressDescription')}
                    </p>
                  </div>
                </label>

                {hasDifferentReturnAddress && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">
                        {t('returnAddress')}
                      </label>
                      <div className="mt-2">
                        <AddressInput
                          value={returnAddress.address}
                          latitude={returnAddress.latitude}
                          longitude={returnAddress.longitude}
                          onChange={onReturnAddressChange}
                          placeholder={t('returnAddressPlaceholder')}
                        />
                      </div>
                    </div>

                    {returnError && (
                      <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">
                        {returnError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
