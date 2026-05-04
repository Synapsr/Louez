import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import type { DeliverySettings, LegMethod } from '@louez/types';
import {
  calculateTotalDeliveryFee,
  calculateHaversineDistance,
  isDeliveryOrderAmountEligible,
  validateDelivery,
} from '@/lib/utils/geo';
import { fetchDeliveryDistanceKm } from '@/lib/utils/delivery-distance';

import type { DeliveryAddress } from '../types';
import type { CheckoutLocationOption } from '../types';

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
  deliveryEligibilitySubtotal?: number;
  locations?: CheckoutLocationOption[];
}

export function useCheckoutDelivery({
  deliverySettings,
  storeLatitude,
  storeLongitude,
  subtotal,
  deliveryEligibilitySubtotal = subtotal,
  locations = [],
}: UseCheckoutDeliveryParams) {
  const t = useTranslations('storefront.checkout');
  const queryClient = useQueryClient();

  const hasStoreCoordinates =
    storeLatitude !== null &&
    storeLatitude !== undefined &&
    storeLongitude !== null &&
    storeLongitude !== undefined;

  const isMultiLocationEnabled = Boolean(deliverySettings?.multiLocationEnabled);
  const isAddressDeliveryEnabled = Boolean(deliverySettings?.enabled && hasStoreCoordinates);
  const isDeliveryEnabled = isAddressDeliveryEnabled || isMultiLocationEnabled;
  const deliveryMode = deliverySettings?.mode ?? 'optional';
  const isDeliveryForced =
    isAddressDeliveryEnabled && (deliveryMode === 'required' || deliveryMode === 'included');
  const isDeliveryIncluded = deliveryMode === 'included';
  const isDeliveryAmountEligible = deliverySettings
    ? isDeliveryOrderAmountEligible(deliveryEligibilitySubtotal, deliverySettings)
    : true;

  // --- Outbound leg state ---
  const [outboundMethod, setOutboundMethod] = useState<LegMethod>(
    isDeliveryForced ? 'address' : 'store',
  );
  const [pickupLocationId, setPickupLocationId] = useState<string | null>(null);
  const [outboundAddress, setOutboundAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  );
  const [outboundDistance, setOutboundDistance] = useState<number | null>(null);
  const [outboundFee, setOutboundFee] = useState(0);
  const [outboundError, setOutboundError] = useState<string | null>(null);
  const [outboundIsCalculating, setOutboundIsCalculating] = useState(false);

  // --- Return leg state ---
  const [returnMethod, setReturnMethod] = useState<LegMethod>('store');
  const [returnLocationId, setReturnLocationId] = useState<string | null>(null);
  const [returnAddress, setReturnAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  );
  const [returnDistance, setReturnDistance] = useState<number | null>(null);
  const [returnFee, setReturnFee] = useState(0);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnIsCalculating, setReturnIsCalculating] = useState(false);
  const outboundRequestIdRef = useRef(0);
  const returnRequestIdRef = useRef(0);

  const totalFee = outboundFee + returnFee;

  // Force outbound to address when delivery mode requires it
  useEffect(() => {
    if (isDeliveryForced) {
      setOutboundMethod('address');
    }
  }, [isDeliveryForced]);

  useEffect(() => {
    if (isDeliveryAmountEligible) {
      return;
    }

    if (outboundMethod === 'address') {
      outboundRequestIdRef.current += 1;
      setOutboundMethod('store');
      setOutboundAddress(DEFAULT_DELIVERY_ADDRESS);
      setOutboundDistance(null);
      setOutboundError(null);
      setOutboundIsCalculating(false);
    }

    if (returnMethod === 'address') {
      returnRequestIdRef.current += 1;
      setReturnMethod('store');
      setReturnAddress(DEFAULT_DELIVERY_ADDRESS);
      setReturnDistance(null);
      setReturnError(null);
      setReturnIsCalculating(false);
    }
  }, [isDeliveryAmountEligible, outboundMethod, returnMethod]);

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
    async (
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
      const setIsCalculating =
        leg === 'outbound' ? setOutboundIsCalculating : setReturnIsCalculating;
      const requestIdRef =
        leg === 'outbound' ? outboundRequestIdRef : returnRequestIdRef;

      setAddress((prev) => ({ ...prev, address, latitude, longitude }));
      setError(null);
      const requestId = ++requestIdRef.current;

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
        setIsCalculating(false);
        setDistance(null);
        if (leg === 'outbound') {
          recalculateFees(null, otherDist);
        } else {
          recalculateFees(otherDist, null);
        }
        return;
      }

      setIsCalculating(true);

      let distance: number;
      try {
        distance = await fetchDeliveryDistanceKm(queryClient, {
          originLatitude: storeLatitude,
          originLongitude: storeLongitude,
          destinationLatitude: latitude,
          destinationLongitude: longitude,
        });
      } catch {
        distance = calculateHaversineDistance(
          storeLatitude,
          storeLongitude,
          latitude,
          longitude,
        );
      }

      setDistance(distance);
      setIsCalculating(false);

      if (requestId !== requestIdRef.current) {
        return;
      }

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
    [deliverySettings, queryClient, recalculateFees, storeLatitude, storeLongitude, t],
  );

  // ---------------------------------------------------------------------------
  // Public handlers
  // ---------------------------------------------------------------------------

  const handleOutboundMethodChange = useCallback(
    (method: LegMethod) => {
      setOutboundMethod(method);

      if (method === 'store') {
        outboundRequestIdRef.current += 1;
        setOutboundAddress(DEFAULT_DELIVERY_ADDRESS);
        setOutboundDistance(null);
        setOutboundError(null);
        setOutboundIsCalculating(false);
        recalculateFees(null, returnMethod === 'address' ? returnDistance : null);
      }
    },
    [recalculateFees, returnDistance, returnMethod],
  );

  const handlePickupLocationChange = useCallback((locationId: string | null) => {
    setPickupLocationId(locationId);
  }, []);

  const handleReturnMethodChange = useCallback(
    (method: LegMethod) => {
      setReturnMethod(method);

      if (method === 'store') {
        returnRequestIdRef.current += 1;
        setReturnAddress(DEFAULT_DELIVERY_ADDRESS);
        setReturnDistance(null);
        setReturnError(null);
        setReturnIsCalculating(false);
        recalculateFees(outboundMethod === 'address' ? outboundDistance : null, null);
      }
    },
    [outboundDistance, outboundMethod, recalculateFees],
  );

  const handleReturnLocationChange = useCallback((locationId: string | null) => {
    setReturnLocationId(locationId);
  }, []);

  const handleOutboundAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      void handleLegAddressChange(
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
      void handleLegAddressChange(
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

  const canContinue =
    !hasOutboundAddressError &&
    !hasReturnAddressError &&
    !outboundIsCalculating &&
    !returnIsCalculating;

  return useMemo(
    () => ({
      // Feature flags
      isDeliveryEnabled,
      isMultiLocationEnabled,
      isAddressDeliveryEnabled,
      locations,
      isDeliveryForced,
      isDeliveryIncluded,
      isDeliveryAmountEligible,

      // Outbound leg
      outboundMethod,
      pickupLocationId,
      handlePickupLocationChange,
      outboundAddress,
      outboundDistance,
      outboundFee,
      outboundError,
      outboundIsCalculating,
      handleOutboundMethodChange,
      handleOutboundAddressChange,

      // Return leg
      returnMethod,
      returnLocationId,
      handleReturnLocationChange,
      returnAddress,
      returnDistance,
      returnFee,
      returnError,
      returnIsCalculating,
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
      handlePickupLocationChange,
      handleReturnAddressChange,
      handleReturnMethodChange,
      handleReturnLocationChange,
      isDeliveryEnabled,
      isMultiLocationEnabled,
      isAddressDeliveryEnabled,
      locations,
      isDeliveryForced,
      isDeliveryIncluded,
      isDeliveryAmountEligible,
      outboundAddress,
      outboundDistance,
      outboundError,
      outboundFee,
      outboundIsCalculating,
      outboundMethod,
      pickupLocationId,
      returnAddress,
      returnDistance,
      returnError,
      returnFee,
      returnIsCalculating,
      returnMethod,
      returnLocationId,
      totalFee,
    ],
  );
}
