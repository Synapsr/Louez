'use client';

import { MapPin, Store, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { DeliverySettings, LegMethod } from '@louez/types';
import {
  Badge,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { cn, formatCurrency } from '@louez/utils';

import { AddressInput } from '@/components/ui/address-input';
import { isFreeDelivery } from '@/lib/utils/geo';

import type { CheckoutLocationOption, DeliveryAddress } from '../types';

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
  storeName?: string;
  isMultiLocationEnabled: boolean;
  isAddressDeliveryEnabled: boolean;
  locations: CheckoutLocationOption[];
  selectedLocationId: string | null;
  onLocationChange: (locationId: string | null) => void;
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
  isDeliveryAmountEligible: boolean;
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
  storeName,
  isMultiLocationEnabled,
  isAddressDeliveryEnabled,
  locations,
  selectedLocationId,
  onLocationChange,
  deliverySettings,
  subtotal,
  currency,
  isOutboundForced,
  isDeliveryIncluded,
  isDeliveryAmountEligible,
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
  const locationLabel = isOutbound ? t('pickupAtLocation') : t('returnAtLocation');
  const selectedLocation = locations.find((location) => location.id === selectedLocationId)
    ?? locations[0]
    ?? {
      id: null,
      name: storeName || t('storeLocationFallback'),
      address: storeAddress ?? null,
      city: null,
      postalCode: null,
      country: null,
    };
  const locationValue = selectedLocationId ?? 'primary';
  const minimumOrderAmount = deliverySettings.minimumOrderAmountForDelivery ?? null;

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
              'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
              method === 'store'
                ? 'border-primary bg-primary/5'
                : 'hover:bg-muted/50',
            )}
          >
            <RadioGroupItem value="store" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Store className="h-4 w-4 shrink-0" />
                <span className="min-w-0 font-medium text-sm">
                  {isMultiLocationEnabled ? locationLabel : storeLabel}
                </span>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {t('free')}
                </Badge>
              </div>
              {isMultiLocationEnabled ? (
                <div className="mt-2 w-full min-w-0 max-w-full space-y-2">
                  <Select
                    value={locationValue}
                    onValueChange={(value) => onLocationChange(value === 'primary' ? null : value)}
                  >
                    <SelectTrigger className="h-auto min-h-10 w-full min-w-0 max-w-full items-start overflow-hidden py-2 text-left">
                      <SelectValue className="min-w-0">
                        <span className="block max-w-full truncate text-sm font-medium">
                          {selectedLocation.name}
                        </span>
                        {selectedLocation.address && (
                          <span className="text-muted-foreground block max-w-full truncate text-xs">
                            {selectedLocation.address}
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((location) => {
                        const value = location.id ?? 'primary';
                        const locationAddress = [
                          location.address,
                          [location.postalCode, location.city].filter(Boolean).join(' '),
                        ]
                          .filter(Boolean)
                          .join(', ');

                        return (
                          <SelectItem
                            key={value}
                            value={value}
                            label={location.name}
                            className="min-w-0"
                          >
                            <span className="block max-w-full truncate text-sm font-medium">
                              {location.name}
                            </span>
                            {locationAddress && (
                              <span className="text-muted-foreground block max-w-full truncate text-xs">
                                {locationAddress}
                              </span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              ) : storeAddress && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {storeAddress}
                </p>
              )}
            </div>
          </label>

          {/* Address option */}
          {isAddressDeliveryEnabled && (
            <label
              className={cn(
                'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                !isDeliveryAmountEligible && 'cursor-not-allowed opacity-60',
                method === 'address'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50',
              )}
            >
              <RadioGroupItem
                value="address"
                className="mt-0.5"
                disabled={!isDeliveryAmountEligible}
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-sm">{addressLabel}</span>
                {isDeliveryAmountEligible ? (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t('deliveryOptionDescription', {
                      pricePerKm: formatCurrency(deliverySettings.pricePerKm, currency),
                    })}
                  </p>
                ) : minimumOrderAmount !== null && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t('deliveryAvailableFrom', {
                      amount: formatCurrency(minimumOrderAmount, currency),
                    })}
                  </p>
                )}
                {deliverySettings.freeDeliveryThreshold &&
                  isFreeDelivery(subtotal, deliverySettings) && (
                    <p className="mt-1 text-xs text-green-600">
                      {t('freeDeliveryApplied')}
                    </p>
                  )}
              </div>
            </label>
          )}
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
