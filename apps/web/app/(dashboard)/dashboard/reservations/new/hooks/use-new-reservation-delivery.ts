import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { DeliverySettings } from '@louez/types'

import {
  calculateDeliveryFee,
  calculateHaversineDistance,
  validateDelivery,
} from '@/lib/utils/geo'

import type { DeliveryAddress, DeliveryOption } from '../types'

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

  const hasStoreCoordinates =
    storeLatitude != null && storeLongitude != null

  const isDeliveryEnabled = Boolean(deliverySettings?.enabled && hasStoreCoordinates)
  const deliveryMode = deliverySettings?.mode ?? 'optional'
  const isDeliveryForced = deliveryMode === 'required' || deliveryMode === 'included'
  const isDeliveryIncluded = deliveryMode === 'included'
  const allowDifferentReturnAddress =
    deliverySettings?.allowDifferentReturnAddress ?? false

  // Delivery state
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>(
    isDeliveryForced ? 'delivery' : 'pickup',
  )
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  )
  const [deliveryDistance, setDeliveryDistance] = useState<number | null>(null)
  const [deliveryFee, setDeliveryFee] = useState(0)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)

  // Return address state
  const [hasDifferentReturnAddress, setHasDifferentReturnAddress] = useState(false)
  const [returnAddress, setReturnAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  )
  const [returnDistance, setReturnDistance] = useState<number | null>(null)
  const [returnError, setReturnError] = useState<string | null>(null)

  useEffect(() => {
    if (isDeliveryForced) {
      setDeliveryOption('delivery')
    }
  }, [isDeliveryForced])

  /**
   * Compute delivery fee from current delivery + return distances.
   * Centralised to avoid duplicating the calculation logic.
   */
  const computeFee = useCallback(
    (
      delDistance: number | null,
      retDistance: number | null,
      hasDiffReturn: boolean,
    ) => {
      if (delDistance === null || !deliverySettings || isDeliveryIncluded) {
        return 0
      }
      return calculateDeliveryFee(
        delDistance,
        deliverySettings,
        subtotal,
        hasDiffReturn ? retDistance : null,
      )
    },
    [deliverySettings, isDeliveryIncluded, subtotal],
  )

  const handleDeliveryAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      setDeliveryAddress((prev) => ({ ...prev, address, latitude, longitude }))
      setDeliveryError(null)

      if (
        latitude === null ||
        longitude === null ||
        storeLatitude == null ||
        storeLongitude == null ||
        !deliverySettings
      ) {
        setDeliveryDistance(null)
        setDeliveryFee(0)
        return
      }

      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude,
      )
      setDeliveryDistance(distance)

      const validation = validateDelivery(distance, deliverySettings)
      if (!validation.valid) {
        setDeliveryError(
          t('deliveryTooFar', {
            maxKm: deliverySettings.maximumDistance ?? 0,
          }),
        )
        setDeliveryFee(0)
        return
      }

      setDeliveryFee(
        computeFee(distance, returnDistance, hasDifferentReturnAddress),
      )
    },
    [
      computeFee,
      deliverySettings,
      hasDifferentReturnAddress,
      returnDistance,
      storeLatitude,
      storeLongitude,
      t,
    ],
  )

  const handleReturnAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      setReturnAddress((prev) => ({ ...prev, address, latitude, longitude }))
      setReturnError(null)

      if (
        latitude === null ||
        longitude === null ||
        storeLatitude == null ||
        storeLongitude == null ||
        !deliverySettings
      ) {
        setReturnDistance(null)
        setDeliveryFee(computeFee(deliveryDistance, null, false))
        return
      }

      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude,
      )
      setReturnDistance(distance)

      const validation = validateDelivery(distance, deliverySettings)
      if (!validation.valid) {
        setReturnError(
          t('returnTooFar', {
            maxKm: deliverySettings.maximumDistance ?? 0,
          }),
        )
        setDeliveryFee(computeFee(deliveryDistance, null, false))
        return
      }

      setDeliveryFee(computeFee(deliveryDistance, distance, true))
    },
    [
      computeFee,
      deliveryDistance,
      deliverySettings,
      storeLatitude,
      storeLongitude,
      t,
    ],
  )

  const handleDifferentReturnAddressToggle = useCallback(
    (checked: boolean) => {
      setHasDifferentReturnAddress(checked)

      if (!checked) {
        setReturnAddress(DEFAULT_DELIVERY_ADDRESS)
        setReturnDistance(null)
        setReturnError(null)
        setDeliveryFee(computeFee(deliveryDistance, null, false))
      }
    },
    [computeFee, deliveryDistance],
  )

  const handleDeliveryOptionChange = useCallback(
    (option: DeliveryOption) => {
      setDeliveryOption(option)

      if (option === 'pickup') {
        setDeliveryFee(0)
        setDeliveryDistance(null)
        setDeliveryError(null)
        setHasDifferentReturnAddress(false)
        setReturnAddress(DEFAULT_DELIVERY_ADDRESS)
        setReturnDistance(null)
        setReturnError(null)
      }
    },
    [],
  )

  return useMemo(
    () => ({
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,
      allowDifferentReturnAddress,
      deliveryOption,
      deliveryAddress,
      deliveryDistance,
      deliveryFee,
      deliveryError,
      hasDifferentReturnAddress,
      returnAddress,
      returnDistance,
      returnError,
      handleDeliveryOptionChange,
      handleDeliveryAddressChange,
      handleReturnAddressChange,
      handleDifferentReturnAddressToggle,
    }),
    [
      isDeliveryEnabled,
      isDeliveryForced,
      isDeliveryIncluded,
      allowDifferentReturnAddress,
      deliveryOption,
      deliveryAddress,
      deliveryDistance,
      deliveryFee,
      deliveryError,
      hasDifferentReturnAddress,
      returnAddress,
      returnDistance,
      returnError,
      handleDeliveryOptionChange,
      handleDeliveryAddressChange,
      handleReturnAddressChange,
      handleDifferentReturnAddressToggle,
    ],
  )
}
