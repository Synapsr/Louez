import { useState, useMemo, useCallback } from 'react'

import type { LegMethod } from '@louez/types'

import {
  calculateHaversineDistance,
  calculateTotalDeliveryFee,
  validateDelivery,
} from '@/lib/utils/geo'

import type { ReservationDelivery, StoreDeliveryInfo } from '../types'

export interface DeliveryLegAddress {
  address: string
  city: string
  postalCode: string
  country: string
  latitude: number | null
  longitude: number | null
}

export interface DeliveryLegState {
  method: LegMethod
  address: DeliveryLegAddress
  distance: number | null
  fee: number
  error: string | null
}

export interface EditDeliveryState {
  outbound: DeliveryLegState
  inbound: DeliveryLegState
  totalFee: number
  hasDeliveryLegs: boolean
  isDeliveryIncluded: boolean
}

function buildInitialLegState(
  method: LegMethod,
  address: string | null,
  city: string | null,
  postalCode: string | null,
  country: string | null,
  latitude: string | null,
  longitude: string | null,
  distanceKm: string | null,
  fee: number,
): DeliveryLegState {
  return {
    method,
    address: {
      address: address ?? '',
      city: city ?? '',
      postalCode: postalCode ?? '',
      country: country ?? 'FR',
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
    },
    distance: distanceKm ? parseFloat(distanceKm) : null,
    fee,
    error: null,
  }
}

interface UseEditReservationDeliveryParams {
  storeDelivery: StoreDeliveryInfo | null
  initialDelivery: ReservationDelivery
  subtotal: number
}

export function useEditReservationDelivery({
  storeDelivery,
  initialDelivery,
  subtotal,
}: UseEditReservationDeliveryParams) {
  const initialDeliveryFee = parseFloat(initialDelivery.deliveryFee ?? '0')

  // Split original fee proportionally between legs for initialization
  const [outbound, setOutbound] = useState<DeliveryLegState>(() =>
    buildInitialLegState(
      initialDelivery.outboundMethod,
      initialDelivery.deliveryAddress,
      initialDelivery.deliveryCity,
      initialDelivery.deliveryPostalCode,
      initialDelivery.deliveryCountry,
      initialDelivery.deliveryLatitude,
      initialDelivery.deliveryLongitude,
      initialDelivery.deliveryDistanceKm,
      initialDeliveryFee,
    ),
  )

  const [inbound, setInbound] = useState<DeliveryLegState>(() =>
    buildInitialLegState(
      initialDelivery.returnMethod,
      initialDelivery.returnAddress,
      initialDelivery.returnCity,
      initialDelivery.returnPostalCode,
      initialDelivery.returnCountry,
      initialDelivery.returnLatitude,
      initialDelivery.returnLongitude,
      initialDelivery.returnDistanceKm,
      0, // Return fee is part of the combined deliveryFee
    ),
  )

  const isDeliveryIncluded = storeDelivery?.settings.mode === 'included'

  // Recalculate fees when distances or subtotal change
  const fees = useMemo(() => {
    if (!storeDelivery) {
      return { outboundFee: 0, returnFee: 0, totalFee: 0 }
    }

    if (isDeliveryIncluded) {
      return { outboundFee: 0, returnFee: 0, totalFee: 0 }
    }

    const outDist = outbound.method === 'address' ? outbound.distance : null
    const retDist = inbound.method === 'address' ? inbound.distance : null

    return calculateTotalDeliveryFee(
      outDist,
      retDist,
      storeDelivery.settings,
      subtotal,
    )
  }, [storeDelivery, isDeliveryIncluded, outbound.method, outbound.distance, inbound.method, inbound.distance, subtotal])

  const recalculateDistance = useCallback(
    (
      leg: 'outbound' | 'inbound',
      address: DeliveryLegAddress,
    ): { distance: number | null; error: string | null } => {
      if (!storeDelivery?.latitude || !storeDelivery?.longitude) {
        return { distance: null, error: null }
      }

      if (!address.latitude || !address.longitude) {
        return { distance: null, error: null }
      }

      const distance = calculateHaversineDistance(
        storeDelivery.latitude,
        storeDelivery.longitude,
        address.latitude,
        address.longitude,
      )

      const validation = validateDelivery(distance, storeDelivery.settings)
      if (!validation.valid) {
        return { distance, error: validation.errorKey ?? null }
      }

      return { distance, error: null }
    },
    [storeDelivery],
  )

  const setOutboundMethod = useCallback(
    (method: LegMethod) => {
      if (method === 'store') {
        setOutbound((prev) => ({
          ...prev,
          method: 'store',
          distance: null,
          fee: 0,
          error: null,
        }))
      } else {
        setOutbound((prev) => {
          const { distance, error } = recalculateDistance('outbound', prev.address)
          return { ...prev, method: 'address', distance, error }
        })
      }
    },
    [recalculateDistance],
  )

  const setInboundMethod = useCallback(
    (method: LegMethod) => {
      if (method === 'store') {
        setInbound((prev) => ({
          ...prev,
          method: 'store',
          distance: null,
          fee: 0,
          error: null,
        }))
      } else {
        setInbound((prev) => {
          const { distance, error } = recalculateDistance('inbound', prev.address)
          return { ...prev, method: 'address', distance, error }
        })
      }
    },
    [recalculateDistance],
  )

  const setOutboundAddress = useCallback(
    (address: DeliveryLegAddress) => {
      const { distance, error } = recalculateDistance('outbound', address)
      setOutbound((prev) => ({
        ...prev,
        address,
        distance,
        error,
      }))
    },
    [recalculateDistance],
  )

  const setInboundAddress = useCallback(
    (address: DeliveryLegAddress) => {
      const { distance, error } = recalculateDistance('inbound', address)
      setInbound((prev) => ({
        ...prev,
        address,
        distance,
        error,
      }))
    },
    [recalculateDistance],
  )

  const hasDeliveryLegs =
    outbound.method === 'address' || inbound.method === 'address'

  const hasErrors = outbound.error !== null || inbound.error !== null

  return {
    outbound: { ...outbound, fee: fees.outboundFee },
    inbound: { ...inbound, fee: fees.returnFee },
    totalFee: fees.totalFee,
    hasDeliveryLegs,
    hasErrors,
    isDeliveryIncluded,
    setOutboundMethod,
    setInboundMethod,
    setOutboundAddress,
    setInboundAddress,
  }
}
