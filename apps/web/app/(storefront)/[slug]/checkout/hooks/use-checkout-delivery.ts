import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { DeliverySettings, LegMethod } from '@louez/types';
import {
  calculateTotalDeliveryFee,
  calculateHaversineDistance,
  validateDelivery,
} from '@/lib/utils/geo';

import type { DeliveryAddress } from '../types';

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

  // --- Outbound leg state ---
  const [outboundMethod, setOutboundMethod] = useState<LegMethod>(
    isDeliveryForced ? 'address' : 'store',
  );
  const [outboundAddress, setOutboundAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  );
  const [outboundDistance, setOutboundDistance] = useState<number | null>(null);
  const [outboundFee, setOutboundFee] = useState(0);
  const [outboundError, setOutboundError] = useState<string | null>(null);

  // --- Return leg state ---
  const [returnMethod, setReturnMethod] = useState<LegMethod>('store');
  const [returnAddress, setReturnAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  );
  const [returnDistance, setReturnDistance] = useState<number | null>(null);
  const [returnFee, setReturnFee] = useState(0);
  const [returnError, setReturnError] = useState<string | null>(null);

  const totalFee = outboundFee + returnFee;

  // Force outbound to address when delivery mode requires it
  useEffect(() => {
    if (isDeliveryForced) {
      setOutboundMethod('address');
    }
  }, [isDeliveryForced]);

  // ---------------------------------------------------------------------------
  // Fee recalculation helper
  // ---------------------------------------------------------------------------
  const recalculateFees = useCallback(
    (outDist: number | null, retDist: number | null) => {
      if (!deliverySettings || isDeliveryIncluded) {
        setOutboundFee(0);
        setReturnFee(0);
        return;
      }

      const result = calculateTotalDeliveryFee(
        outDist,
        retDist,
        deliverySettings,
        subtotal,
      );
      setOutboundFee(result.outboundFee);
      setReturnFee(result.returnFee);
    },
    [deliverySettings, isDeliveryIncluded, subtotal],
  );

  // ---------------------------------------------------------------------------
  // Shared address change handler for a single leg
  // ---------------------------------------------------------------------------
  const handleLegAddressChange = useCallback(
    (
      leg: 'outbound' | 'return',
      address: string,
      latitude: number | null,
      longitude: number | null,
      // Current state of the OTHER leg (to avoid stale closure)
      otherLegDistance: number | null,
      otherLegMethod: LegMethod,
    ) => {
      const setAddress = leg === 'outbound' ? setOutboundAddress : setReturnAddress;
      const setDistance = leg === 'outbound' ? setOutboundDistance : setReturnDistance;
      const setError = leg === 'outbound' ? setOutboundError : setReturnError;

      setAddress((prev) => ({ ...prev, address, latitude, longitude }));
      setError(null);

      const otherDist = otherLegMethod === 'address' ? otherLegDistance : null;

      if (
        latitude === null ||
        longitude === null ||
        storeLatitude === null ||
        storeLatitude === undefined ||
        storeLongitude === null ||
        storeLongitude === undefined ||
        !deliverySettings
      ) {
        setDistance(null);
        if (leg === 'outbound') {
          recalculateFees(null, otherDist);
        } else {
          recalculateFees(otherDist, null);
        }
        return;
      }

      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude,
      );
      setDistance(distance);

      const validation = validateDelivery(distance, deliverySettings);
      if (!validation.valid) {
        setError(
          t('deliveryTooFar', {
            maxKm: deliverySettings.maximumDistance ?? 0,
          }),
        );
        if (leg === 'outbound') {
          recalculateFees(null, otherDist);
        } else {
          recalculateFees(otherDist, null);
        }
        return;
      }

      if (leg === 'outbound') {
        recalculateFees(distance, otherDist);
      } else {
        recalculateFees(otherDist, distance);
      }
    },
    [deliverySettings, recalculateFees, storeLatitude, storeLongitude, t],
  );

  // ---------------------------------------------------------------------------
  // Public handlers
  // ---------------------------------------------------------------------------

  const handleOutboundMethodChange = useCallback(
    (method: LegMethod) => {
      setOutboundMethod(method);

      if (method === 'store') {
        setOutboundAddress(DEFAULT_DELIVERY_ADDRESS);
        setOutboundDistance(null);
        setOutboundError(null);
        recalculateFees(null, returnMethod === 'address' ? returnDistance : null);
      }
    },
    [recalculateFees, returnDistance, returnMethod],
  );

  const handleReturnMethodChange = useCallback(
    (method: LegMethod) => {
      setReturnMethod(method);

      if (method === 'store') {
        setReturnAddress(DEFAULT_DELIVERY_ADDRESS);
        setReturnDistance(null);
        setReturnError(null);
        recalculateFees(outboundMethod === 'address' ? outboundDistance : null, null);
      }
    },
    [outboundDistance, outboundMethod, recalculateFees],
  );

  const handleOutboundAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      handleLegAddressChange(
        'outbound',
        address,
        latitude,
        longitude,
        returnDistance,
        returnMethod,
      );
    },
    [handleLegAddressChange, returnDistance, returnMethod],
  );

  const handleReturnAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      handleLegAddressChange(
        'return',
        address,
        latitude,
        longitude,
        outboundDistance,
        outboundMethod,
      );
    },
    [handleLegAddressChange, outboundDistance, outboundMethod],
  );

  // ---------------------------------------------------------------------------
  // Backward-compatible computed values
  // ---------------------------------------------------------------------------

  /** @deprecated Computed for backward compat. Use outboundMethod/returnMethod. */
  const deliveryOption =
    outboundMethod === 'store' && returnMethod === 'store'
      ? ('pickup' as const)
      : ('delivery' as const);

  /** Whether the continue button should be disabled */
  const hasOutboundAddressError =
    outboundMethod === 'address' &&
    (outboundAddress.latitude === null ||
      outboundAddress.longitude === null ||
      Boolean(outboundError));

  const hasReturnAddressError =
    returnMethod === 'address' &&
    (returnAddress.latitude === null ||
      returnAddress.longitude === null ||
      Boolean(returnError));

  const canContinue = !hasOutboundAddressError && !hasReturnAddressError;

  return useMemo(
    () => ({
      // Feature flags
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,

      // Outbound leg
      outboundMethod,
      outboundAddress,
      outboundDistance,
      outboundFee,
      outboundError,
      handleOutboundMethodChange,
      handleOutboundAddressChange,

      // Return leg
      returnMethod,
      returnAddress,
      returnDistance,
      returnFee,
      returnError,
      handleReturnMethodChange,
      handleReturnAddressChange,

      // Totals
      totalFee,
      canContinue,

      // Backward compat
      deliveryOption,
    }),
    [
      canContinue,
      deliveryOption,
      handleOutboundAddressChange,
      handleOutboundMethodChange,
      handleReturnAddressChange,
      handleReturnMethodChange,
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,
      outboundAddress,
      outboundDistance,
      outboundError,
      outboundFee,
      outboundMethod,
      returnAddress,
      returnDistance,
      returnError,
      returnFee,
      returnMethod,
      totalFee,
    ],
  );
}
