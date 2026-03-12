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
} from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import { AddressInput } from '@/components/ui/address-input'

import type { DeliveryAddress } from '../types'

interface NewReservationStepDeliveryProps {
  deliverySettings: DeliverySettings
  subtotal: number
  currency: string
  storeAddress?: string | null
  isDeliveryForced: boolean
  isDeliveryIncluded: boolean
  // Outbound leg
  outboundMethod: LegMethod
  outboundAddress: DeliveryAddress
  outboundDistance: number | null
  outboundFee: number
  outboundError: string | null
  onOutboundMethodChange: (method: LegMethod) => void
  onOutboundAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void
  // Return leg
  returnMethod: LegMethod
  returnAddress: DeliveryAddress
  returnDistance: number | null
  returnFee: number
  returnError: string | null
  onReturnMethodChange: (method: LegMethod) => void
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
  isForced: boolean
  isDeliveryIncluded: boolean
  currency: string
}) {
  const t = useTranslations('dashboard.reservations.manualForm')

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
              {storeAddress && (
                <p className="text-muted-foreground text-xs mt-0.5">{storeAddress}</p>
              )}
            </div>
          </button>
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
  isDeliveryForced,
  isDeliveryIncluded,
  outboundMethod,
  outboundAddress,
  outboundDistance,
  outboundFee,
  outboundError,
  onOutboundMethodChange,
  onOutboundAddressChange,
  returnMethod,
  returnAddress,
  returnDistance,
  returnFee,
  returnError,
  onReturnMethodChange,
  onReturnAddressChange,
  totalFee,
}: NewReservationStepDeliveryProps) {
  const t = useTranslations('dashboard.reservations.manualForm')
  const hasAnyDelivery = outboundMethod === 'address' || returnMethod === 'address'

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
