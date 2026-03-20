'use client'

import { MapPin, Store, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { LegMethod } from '@louez/types'
import {
  Badge,
  Card,
  CardContent,
  Label,
} from '@louez/ui'
import { cn } from '@louez/utils'

import { AddressInput } from '@/components/ui/address-input'

import type { DeliveryLegAddress, DeliveryLegState } from '../hooks/use-edit-reservation-delivery'

interface DeliveryLegCardProps {
  variant: 'outbound' | 'return'
  icon: React.ReactNode
  leg: DeliveryLegState
  storeAddress: string | null
  currencySymbol: string
  isIncluded: boolean
  onMethodChange: (method: LegMethod) => void
  onAddressChange: (address: DeliveryLegAddress) => void
}

function DeliveryLegCard({
  variant,
  icon,
  leg,
  storeAddress,
  currencySymbol,
  isIncluded,
  onMethodChange,
  onAddressChange,
}: DeliveryLegCardProps) {
  const t = useTranslations('dashboard.reservations.edit.delivery')
  const isOutbound = variant === 'outbound'
  const title = isOutbound ? t('outboundTitle') : t('returnTitle')

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
            {storeAddress && (
              <p className="truncate text-xs text-muted-foreground">
                {storeAddress}
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
  storeAddress: string | null
  currencySymbol: string
  onOutboundMethodChange: (method: LegMethod) => void
  onInboundMethodChange: (method: LegMethod) => void
  onOutboundAddressChange: (address: DeliveryLegAddress) => void
  onInboundAddressChange: (address: DeliveryLegAddress) => void
}

export function EditReservationDeliverySection({
  outbound,
  inbound,
  totalFee,
  isDeliveryIncluded,
  storeAddress,
  currencySymbol,
  onOutboundMethodChange,
  onInboundMethodChange,
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
          <DeliveryLegCard
            variant="outbound"
            icon={<Truck className="h-4 w-4 text-muted-foreground" />}
            leg={outbound}
            storeAddress={storeAddress}
            currencySymbol={currencySymbol}
            isIncluded={isDeliveryIncluded}
            onMethodChange={onOutboundMethodChange}
            onAddressChange={onOutboundAddressChange}
          />

          <DeliveryLegCard
            variant="return"
            icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
            leg={inbound}
            storeAddress={storeAddress}
            currencySymbol={currencySymbol}
            isIncluded={isDeliveryIncluded}
            onMethodChange={onInboundMethodChange}
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
