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

import type { DeliveryAddress } from '../types';
import { DeliveryLegCard } from './delivery-leg-card';

interface CheckoutDeliveryStepProps {
  deliverySettings: DeliverySettings;
  subtotal: number;
  currency: string;
  storeAddress?: string | null;
  isDeliveryForced: boolean;
  isDeliveryIncluded: boolean;
  // Outbound leg
  outboundMethod: LegMethod;
  outboundAddress: DeliveryAddress;
  outboundDistance: number | null;
  outboundFee: number;
  outboundError: string | null;
  onOutboundMethodChange: (method: LegMethod) => void;
  onOutboundAddressChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => void;
  // Return leg
  returnMethod: LegMethod;
  returnAddress: DeliveryAddress;
  returnDistance: number | null;
  returnFee: number;
  returnError: string | null;
  onReturnMethodChange: (method: LegMethod) => void;
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
          deliverySettings={deliverySettings}
          subtotal={subtotal}
          currency={currency}
          isOutboundForced={isDeliveryForced}
          isDeliveryIncluded={isDeliveryIncluded}
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
          deliverySettings={deliverySettings}
          subtotal={subtotal}
          currency={currency}
          isOutboundForced={false}
          isDeliveryIncluded={isDeliveryIncluded}
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
