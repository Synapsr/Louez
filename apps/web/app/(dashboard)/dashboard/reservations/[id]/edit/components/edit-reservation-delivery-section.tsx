'use client'

import { MapPin, Store, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { LegMethod } from '@louez/types'
import {
  Badge,
  Card,
  CardContent,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { cn } from '@louez/utils'

import { AddressInput } from '@/components/ui/address-input'

import type { DeliveryLegAddress, DeliveryLegState } from '../hooks/use-edit-reservation-delivery'
import type { ReservationLocationOption } from '../types'

interface DeliveryLegCardProps {
  variant: 'outbound' | 'return'
  icon: React.ReactNode
  leg: DeliveryLegState
  storeAddress: string | null
  locations: ReservationLocationOption[]
  currencySymbol: string
  isIncluded: boolean
  onMethodChange: (method: LegMethod) => void
  onLocationChange: (locationId: string | null) => void
  onAddressChange: (address: DeliveryLegAddress) => void
}

function DeliveryLegCard({
  variant,
  icon,
  leg,
  storeAddress,
  locations,
  currencySymbol,
  isIncluded,
  onMethodChange,
  onLocationChange,
  onAddressChange,
}: DeliveryLegCardProps) {
  const t = useTranslations('dashboard.reservations.edit.delivery')
  const isOutbound = variant === 'outbound'
  const title = isOutbound ? t('outboundTitle') : t('returnTitle')
  const selectedLocation =
    locations.find((location) => location.id === leg.locationId) ??
    locations[0] ??
    null
  const selectedLocationAddress = selectedLocation
    ? [
        selectedLocation.address,
        [selectedLocation.postalCode, selectedLocation.city].filter(Boolean).join(' '),
      ].filter(Boolean).join(', ')
    : storeAddress

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onMethodChange('store')}
          className={cn(
            'flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
            leg.method === 'store'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'hover:border-muted-foreground/30',
          )}
        >
          <Store className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">
              {isOutbound ? t('storePickup') : t('storeReturn')}
            </p>
            {selectedLocationAddress && (
              <p className="truncate text-xs text-muted-foreground">
                {selectedLocationAddress}
              </p>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onMethodChange('address')}
          className={cn(
            'flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
            leg.method === 'address'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'hover:border-muted-foreground/30',
          )}
        >
          <MapPin className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">
              {isOutbound ? t('deliverToAddress') : t('collectFromAddress')}
            </p>
            {isIncluded ? (
              <p className="text-xs text-emerald-600">{t('included')}</p>
            ) : leg.fee > 0 ? (
              <p className="text-xs text-muted-foreground">
                {leg.fee.toFixed(2)}{currencySymbol}
              </p>
            ) : null}
          </div>
        </button>
      </div>

      {leg.method === 'store' && locations.length > 1 && (
        <div className="space-y-2">
          <Label className="text-xs">
            {isOutbound ? t('pickupLocation') : t('returnLocation')}
          </Label>
          <Select
            value={leg.locationId ?? 'primary'}
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

      {leg.method === 'address' && (
        <div className="space-y-2">
          <Label className="text-xs">{t('addressPlaceholder')}</Label>
          <AddressInput
            value={leg.address.address}
            latitude={leg.address.latitude}
            longitude={leg.address.longitude}
            onChange={(address, latitude, longitude) => {
              onAddressChange({
                address,
                city: leg.address.city,
                postalCode: leg.address.postalCode,
                country: leg.address.country,
                latitude,
                longitude,
              })
            }}
            placeholder={t('addressPlaceholder')}
          />

          {leg.distance !== null && !leg.error && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('distance')}: {leg.distance.toFixed(1)} km
              </span>
              {isIncluded ? (
                <Badge variant="secondary" className="text-[10px]">
                  {t('included')}
                </Badge>
              ) : leg.fee > 0 ? (
                <span>
                  {t('fee')}: {leg.fee.toFixed(2)}{currencySymbol}
                </span>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  {t('free')}
                </Badge>
              )}
            </div>
          )}

          {leg.error && (
            <p className="text-xs text-destructive">
              {t('tooFar', { maxDistance: '' })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface EditReservationDeliverySectionProps {
  outbound: DeliveryLegState & { fee: number }
  inbound: DeliveryLegState & { fee: number }
  totalFee: number
  isDeliveryIncluded: boolean
  deliveryMinimumWarning: string | null
  storeAddress: string | null
  locations: ReservationLocationOption[]
  currencySymbol: string
  onOutboundMethodChange: (method: LegMethod) => void
  onInboundMethodChange: (method: LegMethod) => void
  onOutboundLocationChange: (locationId: string | null) => void
  onInboundLocationChange: (locationId: string | null) => void
  onOutboundAddressChange: (address: DeliveryLegAddress) => void
  onInboundAddressChange: (address: DeliveryLegAddress) => void
}

export function EditReservationDeliverySection({
  outbound,
  inbound,
  totalFee,
  isDeliveryIncluded,
  deliveryMinimumWarning,
  storeAddress,
  locations,
  currencySymbol,
  onOutboundMethodChange,
  onInboundMethodChange,
  onOutboundLocationChange,
  onInboundLocationChange,
  onOutboundAddressChange,
  onInboundAddressChange,
}: EditReservationDeliverySectionProps) {
  const t = useTranslations('dashboard.reservations.edit.delivery')

  const hasDeliveryLegs =
    outbound.method === 'address' || inbound.method === 'address'

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          {t('title')}
        </h2>

        <div className="space-y-6">
          {deliveryMinimumWarning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {deliveryMinimumWarning}
            </div>
          )}

          <DeliveryLegCard
            variant="outbound"
            icon={<Truck className="h-4 w-4 text-muted-foreground" />}
            leg={outbound}
            storeAddress={storeAddress}
            locations={locations}
            currencySymbol={currencySymbol}
            isIncluded={isDeliveryIncluded}
            onMethodChange={onOutboundMethodChange}
            onLocationChange={onOutboundLocationChange}
            onAddressChange={onOutboundAddressChange}
          />

          <DeliveryLegCard
            variant="return"
            icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
            leg={inbound}
            storeAddress={storeAddress}
            locations={locations}
            currencySymbol={currencySymbol}
            isIncluded={isDeliveryIncluded}
            onMethodChange={onInboundMethodChange}
            onLocationChange={onInboundLocationChange}
            onAddressChange={onInboundAddressChange}
          />

          {hasDeliveryLegs && !isDeliveryIncluded && totalFee > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-sm font-medium">{t('totalFee')}</span>
              <span className="text-sm font-semibold">
                {totalFee.toFixed(2)}{currencySymbol}
              </span>
            </div>
          )}

          {hasDeliveryLegs && isDeliveryIncluded && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/20">
              <span className="text-sm font-medium">{t('totalFee')}</span>
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                {t('included')}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
