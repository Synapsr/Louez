'use client'

import { MapPin, Store, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { DeliverySettings, LegMethod } from '@louez/types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import { AddressInput } from '@/components/ui/address-input'

import type { DeliveryAddress, ReservationLocationOption } from '../types'

interface NewReservationStepDeliveryProps {
  deliverySettings: DeliverySettings
  subtotal: number
  currency: string
  storeAddress?: string | null
  locations: ReservationLocationOption[]
  isDeliveryForced: boolean
  isDeliveryIncluded: boolean
  // Outbound leg
  outboundMethod: LegMethod
  pickupLocationId: string | null
  outboundAddress: DeliveryAddress
  outboundDistance: number | null
  outboundFee: number
  outboundError: string | null
  onOutboundMethodChange: (method: LegMethod) => void
  onPickupLocationChange: (locationId: string | null) => void
  onOutboundAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void
  // Return leg
  returnMethod: LegMethod
  returnLocationId: string | null
  returnAddress: DeliveryAddress
  returnDistance: number | null
  returnFee: number
  returnError: string | null
  onReturnMethodChange: (method: LegMethod) => void
  onReturnLocationChange: (locationId: string | null) => void
  onReturnAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void
  // Totals
  totalFee: number
}

function DeliveryLeg({
  leg,
  method,
  onMethodChange,
  address,
  onAddressChange,
  distance,
  fee,
  error,
  storeAddress,
  locations,
  selectedLocationId,
  onLocationChange,
  isForced,
  isDeliveryIncluded,
  currency,
}: {
  leg: 'outbound' | 'return'
  method: LegMethod
  onMethodChange: (method: LegMethod) => void
  address: DeliveryAddress
  onAddressChange: (address: string, lat: number | null, lng: number | null) => void
  distance: number | null
  fee: number
  error: string | null
  storeAddress?: string | null
  locations: ReservationLocationOption[]
  selectedLocationId: string | null
  onLocationChange: (locationId: string | null) => void
  isForced: boolean
  isDeliveryIncluded: boolean
  currency: string
}) {
  const t = useTranslations('dashboard.reservations.manualForm')
  const selectedLocation =
    locations.find((location) => location.id === selectedLocationId) ??
    locations[0] ??
    null
  const selectedLocationAddress = selectedLocation
    ? [
        selectedLocation.address,
        [selectedLocation.postalCode, selectedLocation.city].filter(Boolean).join(' '),
      ].filter(Boolean).join(', ')
    : storeAddress

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">
        {leg === 'outbound' ? t('outboundLeg') : t('returnLeg')}
      </h3>

      {/* Method selector */}
      {!isForced && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onMethodChange('address')}
            className={cn(
              'flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all',
              method === 'address'
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
            )}
          >
            <Truck className={cn(
              'h-5 w-5 shrink-0',
              method === 'address' ? 'text-primary' : 'text-muted-foreground',
            )} />
            <div>
              <span className="text-sm font-medium">{t('deliveryYes')}</span>
              <p className="text-muted-foreground text-xs mt-0.5">
                {leg === 'outbound' ? t('outboundDeliveryDescription') : t('returnDeliveryDescription')}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onMethodChange('store')}
            className={cn(
              'flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all',
              method === 'store'
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
            )}
          >
            <Store className={cn(
              'h-5 w-5 shrink-0',
              method === 'store' ? 'text-primary' : 'text-muted-foreground',
            )} />
            <div>
              <span className="text-sm font-medium">{t('deliveryNo')}</span>
              {selectedLocationAddress && (
                <p className="text-muted-foreground text-xs mt-0.5">{selectedLocationAddress}</p>
              )}
            </div>
          </button>
        </div>
      )}

      {method === 'store' && locations.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {leg === 'outbound' ? t('pickupLocation') : t('returnLocation')}
          </label>
          <Select
            value={selectedLocationId ?? 'primary'}
            onValueChange={(value) => onLocationChange(value === 'primary' ? null : value)}
          >
            <SelectTrigger className="h-auto min-h-10 w-full min-w-0 max-w-full items-start overflow-hidden py-2 text-left">
              <SelectValue className="min-w-0">
                <span className="block max-w-full truncate text-sm font-medium">
                  {selectedLocation?.name ?? t('storeLocationFallback')}
                </span>
                {selectedLocationAddress && (
                  <span className="block max-w-full truncate text-xs text-muted-foreground">
                    {selectedLocationAddress}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => {
                const value = location.id ?? 'primary'
                const locationAddress = [
                  location.address,
                  [location.postalCode, location.city].filter(Boolean).join(' '),
                ].filter(Boolean).join(', ')

                return (
                  <SelectItem key={value} value={value} label={location.name}>
                    <span className="block max-w-full truncate text-sm font-medium">
                      {location.name}
                    </span>
                    {locationAddress && (
                      <span className="block max-w-full truncate text-xs text-muted-foreground">
                        {locationAddress}
                      </span>
                    )}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Forced delivery banner */}
      {isForced && (
        <div className={cn(
          'flex items-start gap-3 rounded-lg p-4',
          isDeliveryIncluded
            ? 'bg-green-50 dark:bg-green-950/30'
            : 'bg-blue-50 dark:bg-blue-950/30',
        )}>
          <Truck className={cn(
            'mt-0.5 h-5 w-5 shrink-0',
            isDeliveryIncluded
              ? 'text-green-600 dark:text-green-400'
              : 'text-blue-600 dark:text-blue-400',
          )} />
          <p className={cn(
            'text-sm font-medium',
            isDeliveryIncluded
              ? 'text-green-700 dark:text-green-300'
              : 'text-blue-700 dark:text-blue-300',
          )}>
            {isDeliveryIncluded ? t('deliveryIncludedBanner') : t('deliveryRequiredBanner')}
          </p>
        </div>
      )}

      {/* Address input */}
      {method === 'address' && (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">
              {leg === 'outbound' ? t('deliveryAddress') : t('returnAddress')}
            </label>
            <div className="mt-2">
              <AddressInput
                value={address.address}
                latitude={address.latitude}
                longitude={address.longitude}
                onChange={onAddressChange}
                placeholder={leg === 'outbound' ? t('deliveryAddressPlaceholder') : t('returnAddressPlaceholder')}
              />
            </div>
          </div>

          {/* Distance & fee */}
          {distance !== null && !error && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {t('deliveryDistance')}
                </span>
                <span>{distance.toFixed(1)} km</span>
              </div>
              {!isDeliveryIncluded && (
                <div className="mt-1 flex justify-between text-sm font-medium">
                  <span>{t('deliveryFee')}</span>
                  <span className={fee === 0 ? 'text-green-600' : ''}>
                    {fee === 0 ? t('free') : formatCurrency(fee, currency)}
                  </span>
                </div>
              )}
              {isDeliveryIncluded && (
                <div className="mt-1 flex justify-between text-sm font-medium text-green-600">
                  <span>{t('deliveryFee')}</span>
                  <span>{t('included')}</span>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function NewReservationStepDelivery({
  deliverySettings,
  subtotal,
  currency,
  storeAddress,
  locations,
  isDeliveryForced,
  isDeliveryIncluded,
  outboundMethod,
  pickupLocationId,
  outboundAddress,
  outboundDistance,
  outboundFee,
  outboundError,
  onOutboundMethodChange,
  onPickupLocationChange,
  onOutboundAddressChange,
  returnMethod,
  returnLocationId,
  returnAddress,
  returnDistance,
  returnFee,
  returnError,
  onReturnMethodChange,
  onReturnLocationChange,
  onReturnAddressChange,
  totalFee,
}: NewReservationStepDeliveryProps) {
  const t = useTranslations('dashboard.reservations.manualForm')
  const hasAnyDelivery = outboundMethod === 'address' || returnMethod === 'address'
  const deliveryMinimumAmount = deliverySettings.minimumOrderAmountForDelivery ?? null
  const isBelowDeliveryMinimum =
    deliverySettings.mode === 'optional' &&
    deliveryMinimumAmount !== null &&
    subtotal < deliveryMinimumAmount

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
        {hasAnyDelivery && isBelowDeliveryMinimum && (
          <div className="rounded-lg bg-warning/10 p-3 text-sm text-foreground">
            {t('deliveryMinimumOverrideWarning', {
              amount: formatCurrency(deliveryMinimumAmount, currency),
            })}
          </div>
        )}

        {/* Outbound leg */}
        <DeliveryLeg
          leg="outbound"
          method={outboundMethod}
          onMethodChange={onOutboundMethodChange}
          address={outboundAddress}
          onAddressChange={onOutboundAddressChange}
          distance={outboundDistance}
          fee={outboundFee}
          error={outboundError}
          storeAddress={storeAddress}
          locations={locations}
          selectedLocationId={pickupLocationId}
          onLocationChange={onPickupLocationChange}
          isForced={isDeliveryForced}
          isDeliveryIncluded={isDeliveryIncluded}
          currency={currency}
        />

        <Separator />

        {/* Return leg */}
        <DeliveryLeg
          leg="return"
          method={returnMethod}
          onMethodChange={onReturnMethodChange}
          address={returnAddress}
          onAddressChange={onReturnAddressChange}
          distance={returnDistance}
          fee={returnFee}
          error={returnError}
          storeAddress={storeAddress}
          locations={locations}
          selectedLocationId={returnLocationId}
          onLocationChange={onReturnLocationChange}
          isForced={false}
          isDeliveryIncluded={isDeliveryIncluded}
          currency={currency}
        />

        {/* Total fee */}
        {hasAnyDelivery && !isDeliveryIncluded && (
          <>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>{t('totalDeliveryFee')}</span>
              <span className={totalFee === 0 ? 'text-green-600' : 'text-primary'}>
                {totalFee === 0 ? t('free') : formatCurrency(totalFee, currency)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
