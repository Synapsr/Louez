'use client';

import {
  ArrowRight,
  ChevronLeft,
  Store,
  Truck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { DeliverySettings } from '@louez/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  RadioGroup,
  RadioGroupItem,
} from '@louez/ui';
import { cn, formatCurrency } from '@louez/utils';

import { AddressInput } from '@/components/ui/address-input';
import { isFreeDelivery } from '@/lib/utils/geo';

import type { DeliveryAddress, DeliveryOption } from '../types';

interface CheckoutDeliveryStepProps {
  deliverySettings: DeliverySettings;
  deliveryOption: DeliveryOption;
  deliveryAddress: DeliveryAddress;
  deliveryDistance: number | null;
  deliveryFee: number;
  deliveryError: string | null;
  subtotal: number;
  currency: string;
  storeAddress?: string | null;
  isDeliveryForced: boolean;
  isDeliveryIncluded: boolean;
  onDeliveryOptionChange: (option: DeliveryOption) => void;
  onDeliveryAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function CheckoutDeliveryStep({
  deliverySettings,
  deliveryOption,
  deliveryAddress,
  deliveryDistance,
  deliveryFee,
  deliveryError,
  subtotal,
  currency,
  storeAddress,
  isDeliveryForced,
  isDeliveryIncluded,
  onDeliveryOptionChange,
  onDeliveryAddressChange,
  onBack,
  onContinue,
}: CheckoutDeliveryStepProps) {
  const t = useTranslations('storefront.checkout');
  const shouldShowDeliveryInput =
    deliveryOption === 'delivery' || isDeliveryForced;

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{t('steps.delivery')}</h2>
          <p className="text-muted-foreground text-sm">
            {isDeliveryForced
              ? isDeliveryIncluded
                ? t('deliveryIncludedDescription')
                : t('deliveryRequiredDescription')
              : t('deliveryDescription')}
          </p>
        </div>

        {!isDeliveryForced && (
          <RadioGroup
            value={deliveryOption}
            onValueChange={(value) =>
              onDeliveryOptionChange(value as DeliveryOption)
            }
            className="grid gap-3"
          >
            <label
              className={cn(
                'flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors',
                deliveryOption === 'pickup'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50',
              )}
            >
              <RadioGroupItem value="pickup" id="pickup" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  <span className="font-medium">{t('pickupOption')}</span>
                  <Badge variant="secondary">{t('free')}</Badge>
                </div>
                {storeAddress && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {storeAddress}
                  </p>
                )}
              </div>
            </label>

            <label
              className={cn(
                'flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors',
                deliveryOption === 'delivery'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50',
              )}
            >
              <RadioGroupItem value="delivery" id="delivery" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  <span className="font-medium">{t('deliveryOption')}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('deliveryOptionDescription', {
                    pricePerKm: formatCurrency(deliverySettings.pricePerKm, currency),
                  })}
                </p>
                {deliverySettings.freeDeliveryThreshold &&
                  isFreeDelivery(subtotal, deliverySettings) && (
                    <p className="mt-1 text-sm text-green-600">
                      {t('freeDeliveryApplied')}
                    </p>
                  )}
                {deliverySettings.freeDeliveryThreshold &&
                  !isFreeDelivery(subtotal, deliverySettings) && (
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t('freeDeliveryAbove', {
                        amount: formatCurrency(
                          deliverySettings.freeDeliveryThreshold,
                          currency,
                        ),
                      })}
                    </p>
                  )}
              </div>
            </label>
          </RadioGroup>
        )}

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

        {shouldShowDeliveryInput && (
          <div className={cn('space-y-4', !isDeliveryForced && 'border-t pt-6')}>
            <div>
              <label className="text-sm font-medium">{t('deliveryAddress')}</label>
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

            {deliveryDistance !== null && !deliveryError && (
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex justify-between text-sm">
                  <span>{t('deliveryDistance')}</span>
                  <span>{deliveryDistance.toFixed(1)} km</span>
                </div>
                {!isDeliveryIncluded && (
                  <div className="mt-2 flex justify-between font-medium">
                    <span>{t('deliveryFee')}</span>
                    <span className={deliveryFee === 0 ? 'text-green-600' : ''}>
                      {deliveryFee === 0
                        ? t('free')
                        : formatCurrency(deliveryFee, currency)}
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
                  deliverySettings.freeDeliveryThreshold && (
                    <p className="mt-1 text-xs text-green-600">
                      {t('freeDeliveryApplied')}
                    </p>
                  )}
                {deliverySettings.roundTrip && !isDeliveryIncluded && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t('roundTripNote', {
                      distance: deliveryDistance.toFixed(1),
                      total: (deliveryDistance * 2).toFixed(1),
                    })}
                  </p>
                )}
              </div>
            )}

            {deliveryError && (
              <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">
                {deliveryError}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t('back')}
          </Button>
          <Button
            type="button"
            onClick={onContinue}
            className="flex-1"
            disabled={
              deliveryOption === 'delivery' &&
              (deliveryAddress.latitude === null ||
                deliveryAddress.longitude === null ||
                Boolean(deliveryError))
            }
          >
            {t('continue')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
