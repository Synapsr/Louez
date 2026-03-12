'use client';

import { MapPin, Store, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { DeliverySettings, LegMethod } from '@louez/types';
import { Badge, RadioGroup, RadioGroupItem } from '@louez/ui';
import { cn, formatCurrency } from '@louez/utils';

import { AddressInput } from '@/components/ui/address-input';
import { isFreeDelivery } from '@/lib/utils/geo';

import type { DeliveryAddress } from '../types';

interface DeliveryLegCardProps {
  /** Which leg this card represents */
  leg: 'outbound' | 'return';
  /** Current method selection */
  method: LegMethod;
  /** Handler for method change */
  onMethodChange: (method: LegMethod) => void;
  /** Current address (when method = 'address') */
  address: DeliveryAddress;
  /** Handler for address change */
  onAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void;
  /** Calculated distance for this leg */
  distance: number | null;
  /** Calculated fee for this leg */
  fee: number;
  /** Validation error */
  error: string | null;
  /** Store's physical address (shown under "store" option) */
  storeAddress?: string | null;
  /** Delivery settings */
  deliverySettings: DeliverySettings;
  /** Order subtotal (for free delivery check) */
  subtotal: number;
  /** Currency code */
  currency: string;
  /** Whether outbound is forced to 'address' (required/included mode) */
  isOutboundForced: boolean;
  /** Whether delivery is included (free) */
  isDeliveryIncluded: boolean;
}

export function DeliveryLegCard({
  leg,
  method,
  onMethodChange,
  address,
  onAddressChange,
  distance,
  fee,
  error,
  storeAddress,
  deliverySettings,
  subtotal,
  currency,
  isOutboundForced,
  isDeliveryIncluded,
}: DeliveryLegCardProps) {
  const t = useTranslations('storefront.checkout');

  const isOutbound = leg === 'outbound';
  const title = isOutbound ? t('outboundTitle') : t('returnTitle');
  const storeLabel = isOutbound ? t('storePickup') : t('storeReturn');
  const addressLabel = isOutbound ? t('deliverToAddress') : t('collectFromAddress');
  const addressPlaceholder = isOutbound
    ? t('outboundAddressPlaceholder')
    : t('returnAddressPlaceholder');
  const LegIcon = isOutbound ? Truck : MapPin;

  // Outbound is forced when mode is 'required' or 'included'
  const isForced = isOutbound && isOutboundForced;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <LegIcon className="text-muted-foreground h-4 w-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>

      {/* Method selector — hidden when this leg is forced */}
      {!isForced && (
        <RadioGroup
          value={method}
          onValueChange={(value) => onMethodChange(value as LegMethod)}
          className="grid gap-3 sm:grid-cols-2"
        >
          {/* Store option */}
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
              method === 'store'
                ? 'border-primary bg-primary/5'
                : 'hover:bg-muted/50',
            )}
          >
            <RadioGroupItem value="store" className="mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 shrink-0" />
                <span className="font-medium text-sm">{storeLabel}</span>
                <Badge variant="secondary" className="text-xs">
                  {t('free')}
                </Badge>
              </div>
              {storeAddress && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {storeAddress}
                </p>
              )}
            </div>
          </label>

          {/* Address option */}
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
              method === 'address'
                ? 'border-primary bg-primary/5'
                : 'hover:bg-muted/50',
            )}
          >
            <RadioGroupItem value="address" className="mt-0.5" />
            <div className="flex-1">
              <span className="font-medium text-sm">{addressLabel}</span>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('deliveryOptionDescription', {
                  pricePerKm: formatCurrency(deliverySettings.pricePerKm, currency),
                })}
              </p>
              {deliverySettings.freeDeliveryThreshold &&
                isFreeDelivery(subtotal, deliverySettings) && (
                  <p className="mt-1 text-xs text-green-600">
                    {t('freeDeliveryApplied')}
                  </p>
                )}
            </div>
          </label>
        </RadioGroup>
      )}

      {/* Forced delivery banner (when outbound is required/included) */}
      {isForced && (
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
                'font-medium text-sm',
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
                'mt-0.5 text-xs',
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

      {/* Address input — shown when method is 'address' */}
      {method === 'address' && (
        <div className="space-y-3">
          <AddressInput
            value={address.address}
            latitude={address.latitude}
            longitude={address.longitude}
            onChange={onAddressChange}
            placeholder={addressPlaceholder}
          />

          {/* Distance & fee summary */}
          {distance !== null && !error && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('deliveryDistance')}</span>
                <span>{distance.toFixed(1)} km</span>
              </div>
              {!isDeliveryIncluded && (
                <div className="mt-1 flex justify-between text-sm font-medium">
                  <span>{t('legFee')}</span>
                  <span className={fee === 0 ? 'text-green-600' : ''}>
                    {fee === 0
                      ? t('free')
                      : formatCurrency(fee, currency)}
                  </span>
                </div>
              )}
              {isDeliveryIncluded && (
                <div className="mt-1 flex justify-between text-sm font-medium text-green-600">
                  <span>{t('legFee')}</span>
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
  );
}
