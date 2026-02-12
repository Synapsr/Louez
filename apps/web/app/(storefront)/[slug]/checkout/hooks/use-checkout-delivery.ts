import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { DeliverySettings } from '@louez/types';
import {
  calculateDeliveryFee,
  calculateHaversineDistance,
  validateDelivery,
} from '@/lib/utils/geo';

import type { DeliveryAddress, DeliveryOption } from '../types';

const DEFAULT_DELIVERY_ADDRESS: DeliveryAddress = {
  address: '',
  city: '',
  postalCode: '',
  country: 'FR',
  latitude: null,
  longitude: null,
};

interface UseCheckoutDeliveryParams {
  deliverySettings?: DeliverySettings;
  storeLatitude?: number | null;
  storeLongitude?: number | null;
  subtotal: number;
}

export function useCheckoutDelivery({
  deliverySettings,
  storeLatitude,
  storeLongitude,
  subtotal,
}: UseCheckoutDeliveryParams) {
  const t = useTranslations('storefront.checkout');

  const hasStoreCoordinates =
    storeLatitude !== null &&
    storeLatitude !== undefined &&
    storeLongitude !== null &&
    storeLongitude !== undefined;

  const isDeliveryEnabled = Boolean(deliverySettings?.enabled && hasStoreCoordinates);
  const deliveryMode = deliverySettings?.mode ?? 'optional';
  const isDeliveryForced =
    deliveryMode === 'required' || deliveryMode === 'included';
  const isDeliveryIncluded = deliveryMode === 'included';

  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>(
    isDeliveryForced ? 'delivery' : 'pickup',
  );
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  );
  const [deliveryDistance, setDeliveryDistance] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  useEffect(() => {
    if (isDeliveryForced) {
      setDeliveryOption('delivery');
    }
  }, [isDeliveryForced]);

  const handleDeliveryAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      setDeliveryAddress((prev) => ({
        ...prev,
        address,
        latitude,
        longitude,
      }));
      setDeliveryError(null);

      if (
        latitude === null ||
        longitude === null ||
        storeLatitude === null ||
        storeLatitude === undefined ||
        storeLongitude === null ||
        storeLongitude === undefined ||
        !deliverySettings
      ) {
        setDeliveryDistance(null);
        setDeliveryFee(0);
        return;
      }

      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude,
      );
      setDeliveryDistance(distance);

      const validation = validateDelivery(distance, deliverySettings);
      if (!validation.valid) {
        setDeliveryError(
          t('deliveryTooFar', {
            maxKm: deliverySettings.maximumDistance ?? 0,
          }),
        );
        setDeliveryFee(0);
        return;
      }

      const fee = isDeliveryIncluded
        ? 0
        : calculateDeliveryFee(distance, deliverySettings, subtotal);
      setDeliveryFee(fee);
    },
    [
      deliverySettings,
      isDeliveryIncluded,
      storeLatitude,
      storeLongitude,
      subtotal,
      t,
    ],
  );

  const handleDeliveryOptionChange = useCallback((option: DeliveryOption) => {
    setDeliveryOption(option);

    if (option === 'pickup') {
      setDeliveryFee(0);
      setDeliveryDistance(null);
      setDeliveryError(null);
    }
  }, []);

  return useMemo(
    () => ({
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,
      deliveryOption,
      deliveryAddress,
      deliveryDistance,
      deliveryFee,
      deliveryError,
      handleDeliveryOptionChange,
      handleDeliveryAddressChange,
    }),
    [
      deliveryAddress,
      deliveryDistance,
      deliveryError,
      deliveryFee,
      deliveryOption,
      handleDeliveryAddressChange,
      handleDeliveryOptionChange,
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,
    ],
  );
}
