'use client';

import { ArrowRight, ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { DeliverySettings, LegMethod } from '@louez/types';
import {
  Button,
  Card,
  CardContent,
  Separator,
} from '@louez/ui';
import { formatCurrency } from '@louez/utils';

import type { CheckoutLocationOption, DeliveryAddress } from '../types';
import { DeliveryLegCard } from './delivery-leg-card';

interface CheckoutDeliveryStepProps {
  deliverySettings: DeliverySettings;
  subtotal: number;
  currency: string;
  storeAddress?: string | null;
  storeName?: string;
  isMultiLocationEnabled: boolean;
  isAddressDeliveryEnabled: boolean;
  locations: CheckoutLocationOption[];
  isDeliveryForced: boolean;
  isDeliveryIncluded: boolean;
  isDeliveryAmountEligible: boolean;
  // Outbound leg
  outboundMethod: LegMethod;
  pickupLocationId: string | null;
  outboundAddress: DeliveryAddress;
  outboundDistance: number | null;
  outboundFee: number;
  outboundError: string | null;
  onOutboundMethodChange: (method: LegMethod) => void;
  onPickupLocationChange: (locationId: string | null) => void;
  onOutboundAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void;
  // Return leg
  returnMethod: LegMethod;
  returnLocationId: string | null;
  returnAddress: DeliveryAddress;
  returnDistance: number | null;
  returnFee: number;
  returnError: string | null;
  onReturnMethodChange: (method: LegMethod) => void;
  onReturnLocationChange: (locationId: string | null) => void;
  onReturnAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void;
  // Totals & navigation
  totalFee: number;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
}

export function CheckoutDeliveryStep({
  deliverySettings,
  subtotal,
  currency,
  storeAddress,
  storeName,
  isMultiLocationEnabled,
  isAddressDeliveryEnabled,
  locations,
  isDeliveryForced,
  isDeliveryIncluded,
  isDeliveryAmountEligible,
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
  canContinue,
  onBack,
  onContinue,
}: CheckoutDeliveryStepProps) {
  const t = useTranslations('storefront.checkout');

  const hasAnyDelivery =
    outboundMethod === 'address' || returnMethod === 'address';

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="mb-2">
          <h2 className="text-lg font-semibold">{t('steps.delivery')}</h2>
          <p className="text-muted-foreground text-sm">
            {t('deliveryDescription')}
          </p>
        </div>

        {/* Outbound leg */}
        <DeliveryLegCard
          leg="outbound"
          method={outboundMethod}
          onMethodChange={onOutboundMethodChange}
          address={outboundAddress}
          onAddressChange={onOutboundAddressChange}
          distance={outboundDistance}
          fee={outboundFee}
          error={outboundError}
          storeAddress={storeAddress}
          storeName={storeName}
          isMultiLocationEnabled={isMultiLocationEnabled}
          isAddressDeliveryEnabled={isAddressDeliveryEnabled}
          locations={locations}
          selectedLocationId={pickupLocationId}
          onLocationChange={onPickupLocationChange}
          deliverySettings={deliverySettings}
          subtotal={subtotal}
          currency={currency}
          isOutboundForced={isDeliveryForced}
          isDeliveryIncluded={isDeliveryIncluded}
          isDeliveryAmountEligible={isDeliveryAmountEligible}
        />

        <Separator />

        {/* Return leg */}
        <DeliveryLegCard
          leg="return"
          method={returnMethod}
          onMethodChange={onReturnMethodChange}
          address={returnAddress}
          onAddressChange={onReturnAddressChange}
          distance={returnDistance}
          fee={returnFee}
          error={returnError}
          storeAddress={storeAddress}
          storeName={storeName}
          isMultiLocationEnabled={isMultiLocationEnabled}
          isAddressDeliveryEnabled={isAddressDeliveryEnabled}
          locations={locations}
          selectedLocationId={returnLocationId}
          onLocationChange={onReturnLocationChange}
          deliverySettings={deliverySettings}
          subtotal={subtotal}
          currency={currency}
          isOutboundForced={false}
          isDeliveryIncluded={isDeliveryIncluded}
          isDeliveryAmountEligible={isDeliveryAmountEligible}
        />

        {/* Total fee summary */}
        {hasAnyDelivery && !isDeliveryIncluded && (
          <>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>{t('totalDeliveryFee')}</span>
              <span className={totalFee === 0 ? 'text-green-600' : 'text-primary'}>
                {totalFee === 0
                  ? t('free')
                  : formatCurrency(totalFee, currency)}
              </span>
            </div>
          </>
        )}

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t('back')}
          </Button>
          <Button
            type="button"
            onClick={onContinue}
            className="flex-1"
            disabled={!canContinue}
          >
            {t('continue')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
