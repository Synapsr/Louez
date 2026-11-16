import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import type { DeliverySettings, LegMethod } from '@louez/types'
import {
  calculateTotalDeliveryFee,
  calculateHaversineDistance,
  validateDelivery,
} from '@/lib/utils/geo'
import { fetchDeliveryDistanceKm } from '@/lib/utils/delivery-distance'

import type { DeliveryAddress } from '../types'

const DEFAULT_DELIVERY_ADDRESS: DeliveryAddress = {
  address: '',
  city: '',
  postalCode: '',
  country: 'FR',
  latitude: null,
  longitude: null,
}

interface UseNewReservationDeliveryParams {
  deliverySettings?: DeliverySettings
  storeLatitude?: number | null
  storeLongitude?: number | null
  subtotal: number
}

export function useNewReservationDelivery({
  deliverySettings,
  storeLatitude,
  storeLongitude,
  subtotal,
}: UseNewReservationDeliveryParams) {
  const t = useTranslations('dashboard.reservations.manualForm')
  const queryClient = useQueryClient()

  const hasStoreCoordinates =
    storeLatitude != null && storeLongitude != null

  const isDeliveryEnabled = Boolean(deliverySettings?.enabled && hasStoreCoordinates)
  const deliveryMode = deliverySettings?.mode ?? 'optional'
  const isDeliveryForced = deliveryMode === 'required' || deliveryMode === 'included'
  const isDeliveryIncluded = deliveryMode === 'included'

  // --- Outbound leg state ---
  const [outboundMethod, setOutboundMethod] = useState<LegMethod>(
    isDeliveryForced ? 'address' : 'store',
  )
  const [pickupLocationId, setPickupLocationId] = useState<string | null>(null)
  const [outboundAddress, setOutboundAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  )
  const [outboundDistance, setOutboundDistance] = useState<number | null>(null)
  const [outboundError, setOutboundError] = useState<string | null>(null)
  const [outboundIsCalculating, setOutboundIsCalculating] = useState(false)

  // --- Return leg state ---
  const [returnMethod, setReturnMethod] = useState<LegMethod>('store')
  const [returnLocationId, setReturnLocationId] = useState<string | null>(null)
  const [returnAddress, setReturnAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  )
  const [returnDistance, setReturnDistance] = useState<number | null>(null)
  const [returnError, setReturnError] = useState<string | null>(null)
  const [returnIsCalculating, setReturnIsCalculating] = useState(false)
  const outboundRequestIdRef = useRef(0)
  const returnRequestIdRef = useRef(0)

  useEffect(() => {
    if (isDeliveryForced) {
      setOutboundMethod('address')
    }
  }, [isDeliveryForced])

  // The fees, from each leg delivered within reach and the delivery settings
  // and subtotal as they are now: settings read again after a refused
  // creation, or a subtotal that moved, are followed at once.
  const { outboundFee, returnFee } = useMemo(() => {
    if (!deliverySettings || isDeliveryIncluded) return { outboundFee: 0, returnFee: 0 }
    return calculateTotalDeliveryFee(
      outboundMethod === 'address' && !outboundError ? outboundDistance : null,
      returnMethod === 'address' && !returnError ? returnDistance : null,
      deliverySettings,
      subtotal,
    )
  }, [
    deliverySettings,
    isDeliveryIncluded,
    outboundDistance,
    outboundError,
    outboundMethod,
    returnDistance,
    returnError,
    returnMethod,
    subtotal,
  ])
  const totalFee = outboundFee + returnFee

  const handleLegAddressChange = useCallback(
    async (
      leg: 'outbound' | 'return',
      address: string,
      latitude: number | null,
      longitude: number | null,
    ) => {
      const setAddress = leg === 'outbound' ? setOutboundAddress : setReturnAddress
      const setDistance = leg === 'outbound' ? setOutboundDistance : setReturnDistance
      const setError = leg === 'outbound' ? setOutboundError : setReturnError
      const setIsCalculating =
        leg === 'outbound' ? setOutboundIsCalculating : setReturnIsCalculating
      const requestIdRef =
        leg === 'outbound' ? outboundRequestIdRef : returnRequestIdRef

      setAddress((prev) => ({ ...prev, address, latitude, longitude }))
      setError(null)
      const requestId = ++requestIdRef.current

      if (
        latitude === null ||
        longitude === null ||
        storeLatitude == null ||
        storeLongitude == null ||
        !deliverySettings
      ) {
        setIsCalculating(false)
        setDistance(null)
        return
      }

      setIsCalculating(true)

      let distance: number
      try {
        distance = await fetchDeliveryDistanceKm(queryClient, {
          originLatitude: storeLatitude,
          originLongitude: storeLongitude,
          destinationLatitude: latitude,
          destinationLongitude: longitude,
        })
      } catch {
        distance = calculateHaversineDistance(
          storeLatitude,
          storeLongitude,
          latitude,
          longitude,
        )
      }

      // An answer for an address the person has since replaced changes nothing:
      // the fee follows the distance, and the newer request ends the wait.
      if (requestId !== requestIdRef.current) {
        return
      }

      setDistance(distance)
      setIsCalculating(false)

      const validation = validateDelivery(distance, deliverySettings)
      if (!validation.valid) {
        setError(
          t('deliveryTooFar', { maxKm: deliverySettings.maximumDistance ?? 0 }),
        )
      }
    },
    [deliverySettings, queryClient, storeLatitude, storeLongitude, t],
  )

  /** Measures the delivery legs again, for a creation refused as changed meanwhile. */
  const remeasure = useCallback(() => {
    if (outboundMethod === 'address') {
      void handleLegAddressChange(
        'outbound',
        outboundAddress.address,
        outboundAddress.latitude,
        outboundAddress.longitude,
      )
    }
    if (returnMethod === 'address') {
      void handleLegAddressChange(
        'return',
        returnAddress.address,
        returnAddress.latitude,
        returnAddress.longitude,
      )
    }
  }, [handleLegAddressChange, outboundAddress, outboundMethod, returnAddress, returnMethod])

  const handleOutboundMethodChange = useCallback(
    (method: LegMethod) => {
      setOutboundMethod(method)
      if (method === 'store') {
        outboundRequestIdRef.current += 1
        setOutboundAddress(DEFAULT_DELIVERY_ADDRESS)
        setOutboundDistance(null)
        setOutboundError(null)
        setOutboundIsCalculating(false)
      }
    },
    [],
  )

  const handleReturnMethodChange = useCallback(
    (method: LegMethod) => {
      setReturnMethod(method)
      if (method === 'store') {
        returnRequestIdRef.current += 1
        setReturnAddress(DEFAULT_DELIVERY_ADDRESS)
        setReturnDistance(null)
        setReturnError(null)
        setReturnIsCalculating(false)
      }
    },
    [],
  )

  const handlePickupLocationChange = useCallback((locationId: string | null) => {
    setPickupLocationId(locationId)
  }, [])

  const handleReturnLocationChange = useCallback((locationId: string | null) => {
    setReturnLocationId(locationId)
  }, [])

  const handleOutboundAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      void handleLegAddressChange('outbound', address, latitude, longitude)
    },
    [handleLegAddressChange],
  )

  const handleReturnAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      void handleLegAddressChange('return', address, latitude, longitude)
    },
    [handleLegAddressChange],
  )

  const deliveryOption =
    outboundMethod === 'store' && returnMethod === 'store'
      ? ('pickup' as const)
      : ('delivery' as const)

  const hasOutboundAddressError =
    outboundMethod === 'address' &&
    (outboundAddress.latitude === null ||
      outboundAddress.longitude === null ||
      Boolean(outboundError))

  const hasReturnAddressError =
    returnMethod === 'address' &&
    (returnAddress.latitude === null ||
      returnAddress.longitude === null ||
      Boolean(returnError))

  const canContinue =
    !hasOutboundAddressError &&
    !hasReturnAddressError &&
    !outboundIsCalculating &&
    !returnIsCalculating

  return useMemo(
    () => ({
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,

      outboundMethod,
      pickupLocationId,
      outboundAddress,
      outboundDistance,
      outboundFee,
      outboundError,
      outboundIsCalculating,
      handleOutboundMethodChange,
      handlePickupLocationChange,
      handleOutboundAddressChange,

      returnMethod,
      returnLocationId,
      returnAddress,
      returnDistance,
      returnFee,
      returnError,
      returnIsCalculating,
      handleReturnMethodChange,
      handleReturnLocationChange,
      handleReturnAddressChange,

      totalFee,
      canContinue,
      deliveryOption,
      remeasure,
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
      isDeliveryForced,
      isDeliveryIncluded,
      outboundAddress,
      outboundDistance,
      outboundError,
      outboundFee,
      outboundIsCalculating,
      outboundMethod,
      pickupLocationId,
      remeasure,
      returnAddress,
      returnDistance,
      returnError,
      returnFee,
      returnIsCalculating,
      returnMethod,
      returnLocationId,
      totalFee,
    ],
  )
}
