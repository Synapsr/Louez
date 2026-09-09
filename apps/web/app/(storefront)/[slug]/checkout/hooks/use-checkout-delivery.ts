import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { DeliverySettings, LegMethod } from "@louez/types";
import {
  calculateTotalDeliveryFee,
  calculateHaversineDistance,
  isDeliveryOrderAmountEligible,
  validateDelivery,
} from "@/lib/utils/geo";
import { fetchDeliveryDistanceKm } from "@/lib/utils/delivery-distance";

import type { CheckoutLocationOption, DeliveryAddress } from "../checkout.types";

const DEFAULT_DELIVERY_ADDRESS: DeliveryAddress = {
  address: "",
  city: "",
  postalCode: "",
  country: "FR",
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

export const useCheckoutDelivery = ({
  deliverySettings,
  storeLatitude,
  storeLongitude,
  subtotal,
  deliveryEligibilitySubtotal = subtotal,
  locations = [],
}: UseCheckoutDeliveryParams) => {
  const t = useTranslations("storefront.checkout");
  const queryClient = useQueryClient();

  const hasStoreCoordinates =
    storeLatitude !== null &&
    storeLatitude !== undefined &&
    storeLongitude !== null &&
    storeLongitude !== undefined;

  const isMultiLocationEnabled = Boolean(deliverySettings?.multiLocationEnabled);
  const isAddressDeliveryEnabled = Boolean(deliverySettings?.enabled && hasStoreCoordinates);
  const isDeliveryEnabled = isAddressDeliveryEnabled || isMultiLocationEnabled;
  const deliveryMode = deliverySettings?.mode ?? "optional";
  const isDeliveryForced =
    isAddressDeliveryEnabled && (deliveryMode === "required" || deliveryMode === "included");
  const isDeliveryIncluded = deliveryMode === "included";
  const isDeliveryAmountEligible = deliverySettings
    ? isDeliveryOrderAmountEligible(deliveryEligibilitySubtotal, deliverySettings)
    : true;

  // --- Outbound leg state ---
  const [outboundMethod, setOutboundMethod] = useState<LegMethod>(
    isDeliveryForced ? "address" : "store",
  );
  const [pickupLocationId, setPickupLocationId] = useState<string | null>(null);
  const [outboundAddress, setOutboundAddress] = useState<DeliveryAddress>(DEFAULT_DELIVERY_ADDRESS);
  const [outboundDistance, setOutboundDistance] = useState<number | null>(null);
  const [outboundError, setOutboundError] = useState<string | null>(null);
  const [outboundIsCalculating, setOutboundIsCalculating] = useState(false);

  // --- Return leg state ---
  /**
   * Most renters bring the equipment back where they collected it, so the
   * return leg mirrors the outbound one until they choose otherwise. Mirroring
   * happens in the handlers below rather than in an effect, so the two legs are
   * never briefly out of step.
   */
  const [isReturnSameAsPickup, setIsReturnSameAsPickup] = useState(true);
  const [returnMethod, setReturnMethod] = useState<LegMethod>("store");
  const [returnLocationId, setReturnLocationId] = useState<string | null>(null);
  const [returnAddress, setReturnAddress] = useState<DeliveryAddress>(DEFAULT_DELIVERY_ADDRESS);
  const [returnDistance, setReturnDistance] = useState<number | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnIsCalculating, setReturnIsCalculating] = useState(false);
  const outboundRequestIdRef = useRef(0);
  const returnRequestIdRef = useRef(0);

  // Derive both fees from the latest leg state; concurrent distance responses
  // must not overwrite a total computed from an earlier render.
  const { outboundFee, returnFee, totalFee } =
    deliverySettings && !isDeliveryIncluded
      ? calculateTotalDeliveryFee(
          outboundMethod === "address" && !outboundError && !outboundIsCalculating
            ? outboundDistance
            : null,
          returnMethod === "address" && !returnError && !returnIsCalculating
            ? returnDistance
            : null,
          deliverySettings,
          subtotal,
        )
      : { outboundFee: 0, returnFee: 0, totalFee: 0 };

  // Force outbound to address when delivery mode requires it
  useEffect(() => {
    if (isDeliveryForced) {
      setOutboundMethod("address");
      // The return leg mirrors the pickup by default, so it has to follow the
      // forced method too — otherwise the step claims "same place" while the
      // two legs disagree. Choosing "somewhere else" frees it again.
      setIsReturnSameAsPickup((isSame) => {
        if (isSame) setReturnMethod("address");
        return isSame;
      });
    }
  }, [isDeliveryForced]);

  useEffect(() => {
    if (isDeliveryAmountEligible) {
      return;
    }

    if (outboundMethod === "address") {
      outboundRequestIdRef.current += 1;
      setOutboundMethod("store");
      setOutboundAddress(DEFAULT_DELIVERY_ADDRESS);
      setOutboundDistance(null);
      setOutboundError(null);
      setOutboundIsCalculating(false);
    }

    if (returnMethod === "address") {
      returnRequestIdRef.current += 1;
      setReturnMethod("store");
      setReturnAddress(DEFAULT_DELIVERY_ADDRESS);
      setReturnDistance(null);
      setReturnError(null);
      setReturnIsCalculating(false);
    }
  }, [isDeliveryAmountEligible, outboundMethod, returnMethod]);

  // ---------------------------------------------------------------------------
  // Shared address change handler for a single leg
  // ---------------------------------------------------------------------------
  const handleLegAddressChange = useCallback(
    async (
      leg: "outbound" | "return",
      address: string,
      latitude: number | null,
      longitude: number | null,
    ) => {
      const setAddress = leg === "outbound" ? setOutboundAddress : setReturnAddress;
      const setDistance = leg === "outbound" ? setOutboundDistance : setReturnDistance;
      const setError = leg === "outbound" ? setOutboundError : setReturnError;
      const setIsCalculating =
        leg === "outbound" ? setOutboundIsCalculating : setReturnIsCalculating;
      const requestIdRef = leg === "outbound" ? outboundRequestIdRef : returnRequestIdRef;

      setAddress((prev) => ({ ...prev, address, latitude, longitude }));
      setError(null);
      const requestId = ++requestIdRef.current;

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
        distance = calculateHaversineDistance(storeLatitude, storeLongitude, latitude, longitude);
      }

      // A newer address change superseded this request: drop the result.
      if (requestId !== requestIdRef.current) {
        return;
      }

      setDistance(distance);
      setIsCalculating(false);

      const validation = validateDelivery(distance, deliverySettings);
      if (!validation.valid) {
        setError(
          t("deliveryTooFar", {
            maxKm: deliverySettings.maximumDistance ?? 0,
          }),
        );
        return;
      }
    },
    [deliverySettings, queryClient, storeLatitude, storeLongitude, t],
  );

  // ---------------------------------------------------------------------------
  // Public handlers
  // ---------------------------------------------------------------------------

  const resetLegToStore = useCallback((leg: "outbound" | "return") => {
    const isOutbound = leg === "outbound";
    const requestIdRef = isOutbound ? outboundRequestIdRef : returnRequestIdRef;
    requestIdRef.current += 1;
    (isOutbound ? setOutboundAddress : setReturnAddress)(DEFAULT_DELIVERY_ADDRESS);
    (isOutbound ? setOutboundDistance : setReturnDistance)(null);
    (isOutbound ? setOutboundError : setReturnError)(null);
    (isOutbound ? setOutboundIsCalculating : setReturnIsCalculating)(false);
  }, []);

  const handleOutboundMethodChange = useCallback(
    (method: LegMethod) => {
      setOutboundMethod(method);

      if (method === "store") {
        resetLegToStore("outbound");
      }

      if (isReturnSameAsPickup) {
        setReturnMethod(method);
        if (method === "store") {
          resetLegToStore("return");
          return;
        }
        // The mirrored address arrives with the next outbound address change.
        resetLegToStore("return");
        return;
      }
    },
    [isReturnSameAsPickup, resetLegToStore],
  );

  const handlePickupLocationChange = useCallback(
    (locationId: string | null) => {
      setPickupLocationId(locationId);
      if (isReturnSameAsPickup) {
        setReturnLocationId(locationId);
      }
    },
    [isReturnSameAsPickup],
  );

  const handleReturnMethodChange = useCallback(
    (method: LegMethod) => {
      setReturnMethod(method);

      if (method === "store") {
        resetLegToStore("return");
      }
    },
    [resetLegToStore],
  );

  const handleReturnLocationChange = useCallback((locationId: string | null) => {
    setReturnLocationId(locationId);
  }, []);

  const handleOutboundAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      void handleLegAddressChange("outbound", address, latitude, longitude);

      // Same journey back: the distance lookup is cached, so this costs nothing.
      if (isReturnSameAsPickup) {
        void handleLegAddressChange("return", address, latitude, longitude);
      }
    },
    [handleLegAddressChange, isReturnSameAsPickup],
  );

  const handleReturnAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      void handleLegAddressChange("return", address, latitude, longitude);
    },
    [handleLegAddressChange],
  );

  /** Point the return leg back at the pickup, or set it free. */
  const handleReturnSameAsPickupChange = useCallback(
    (isSame: boolean) => {
      setIsReturnSameAsPickup(isSame);
      if (!isSame) return;

      setReturnMethod(outboundMethod);
      setReturnLocationId(pickupLocationId);

      if (outboundMethod === "store") {
        resetLegToStore("return");
        return;
      }

      void handleLegAddressChange(
        "return",
        outboundAddress.address,
        outboundAddress.latitude,
        outboundAddress.longitude,
      );
    },
    [handleLegAddressChange, outboundAddress, outboundMethod, pickupLocationId, resetLegToStore],
  );

  /** Whether the continue button should be disabled */
  const hasOutboundAddressError =
    outboundMethod === "address" &&
    (outboundAddress.latitude === null ||
      outboundAddress.longitude === null ||
      Boolean(outboundError));

  const hasReturnAddressError =
    returnMethod === "address" &&
    (returnAddress.latitude === null || returnAddress.longitude === null || Boolean(returnError));

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
      isReturnSameAsPickup,
      handleReturnSameAsPickupChange,
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
      isCalculating: outboundIsCalculating || returnIsCalculating,
    }),
    [
      canContinue,
      handleOutboundAddressChange,
      handleOutboundMethodChange,
      handlePickupLocationChange,
      handleReturnAddressChange,
      handleReturnMethodChange,
      handleReturnLocationChange,
      handleReturnSameAsPickupChange,
      isDeliveryEnabled,
      isReturnSameAsPickup,
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
};
