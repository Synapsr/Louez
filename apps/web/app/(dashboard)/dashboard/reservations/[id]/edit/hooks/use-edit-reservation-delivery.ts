import { useState, useMemo, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { LegMethod } from '@louez/types'

import {
  calculateHaversineDistance,
  calculateTotalDeliveryFee,
  validateDelivery,
} from '@/lib/utils/geo'
import { fetchDeliveryDistanceKm } from '@/lib/utils/delivery-distance'

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
  locationId: string | null
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
  isCalculating: boolean
  isDeliveryIncluded: boolean
}

function buildInitialLegState(
  method: LegMethod,
  locationId: string | null,
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
    locationId,
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
  const queryClient = useQueryClient()
  const initialDeliveryFee = parseFloat(initialDelivery.deliveryFee ?? '0')
  const outboundRequestIdRef = useRef(0)
  const inboundRequestIdRef = useRef(0)

  // Split original fee proportionally between legs for initialization
  const [outbound, setOutbound] = useState<DeliveryLegState>(() =>
    buildInitialLegState(
      initialDelivery.outboundMethod,
      initialDelivery.pickupLocationId,
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
      initialDelivery.returnLocationId,
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
  const [outboundIsCalculating, setOutboundIsCalculating] = useState(false)
  const [inboundIsCalculating, setInboundIsCalculating] = useState(false)

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
      _leg: 'outbound' | 'inbound',
      address: DeliveryLegAddress,
    ): Promise<{ distance: number | null; error: string | null }> => {
      if (!storeDelivery?.latitude || !storeDelivery?.longitude) {
        return Promise.resolve({ distance: null, error: null })
      }

      if (!address.latitude || !address.longitude) {
        return Promise.resolve({ distance: null, error: null })
      }

      const storeLatitude = storeDelivery.latitude
      const storeLongitude = storeDelivery.longitude

      const distancePromise = fetchDeliveryDistanceKm(queryClient, {
        originLatitude: storeLatitude,
        originLongitude: storeLongitude,
        destinationLatitude: address.latitude,
        destinationLongitude: address.longitude,
      }).catch(() =>
        calculateHaversineDistance(
          storeLatitude,
          storeLongitude,
          address.latitude!,
          address.longitude!,
        ),
      )

      return distancePromise.then((distance) => {
        const validation = validateDelivery(distance, storeDelivery.settings)
        if (!validation.valid) {
          return { distance, error: validation.errorKey ?? null }
        }

        return { distance, error: null }
      })
    },
    [queryClient, storeDelivery],
  )

  const setOutboundMethod = useCallback(
    (method: LegMethod) => {
      if (method === 'store') {
        outboundRequestIdRef.current += 1
        setOutboundIsCalculating(false)
        setOutbound((prev) => ({
          ...prev,
          method: 'store',
          distance: null,
          fee: 0,
          error: null,
        }))
      } else {
        setOutbound((prev) => ({ ...prev, method: 'address' }))
        setOutboundIsCalculating(true)
        const requestId = ++outboundRequestIdRef.current
        void recalculateDistance('outbound', outbound.address).then(({ distance, error }) => {
          if (requestId !== outboundRequestIdRef.current) return
          setOutboundIsCalculating(false)
          setOutbound((prev) => ({ ...prev, distance, error }))
        })
      }
    },
    [outbound.address, recalculateDistance],
  )

  const setOutboundLocationId = useCallback((locationId: string | null) => {
    setOutbound((prev) => ({
      ...prev,
      locationId,
    }))
  }, [])

  const setInboundMethod = useCallback(
    (method: LegMethod) => {
      if (method === 'store') {
        inboundRequestIdRef.current += 1
        setInboundIsCalculating(false)
        setInbound((prev) => ({
          ...prev,
          method: 'store',
          distance: null,
          fee: 0,
          error: null,
        }))
      } else {
        setInbound((prev) => ({ ...prev, method: 'address' }))
        setInboundIsCalculating(true)
        const requestId = ++inboundRequestIdRef.current
        void recalculateDistance('inbound', inbound.address).then(({ distance, error }) => {
          if (requestId !== inboundRequestIdRef.current) return
          setInboundIsCalculating(false)
          setInbound((prev) => ({ ...prev, distance, error }))
        })
      }
    },
    [inbound.address, recalculateDistance],
  )

  const setInboundLocationId = useCallback((locationId: string | null) => {
    setInbound((prev) => ({
      ...prev,
      locationId,
    }))
  }, [])

  const setOutboundAddress = useCallback(
    (address: DeliveryLegAddress) => {
      const requestId = ++outboundRequestIdRef.current
      setOutboundIsCalculating(true)
      setOutbound((prev) => ({
        ...prev,
        address,
        distance: null,
        error: null,
      }))
      void recalculateDistance('outbound', address).then(({ distance, error }) => {
        if (requestId !== outboundRequestIdRef.current) return
        setOutboundIsCalculating(false)
        setOutbound((prev) => ({
          ...prev,
          address,
          distance,
          error,
        }))
      })
    },
    [recalculateDistance],
  )

  const setInboundAddress = useCallback(
    (address: DeliveryLegAddress) => {
      const requestId = ++inboundRequestIdRef.current
      setInboundIsCalculating(true)
      setInbound((prev) => ({
        ...prev,
        address,
        distance: null,
        error: null,
      }))
      void recalculateDistance('inbound', address).then(({ distance, error }) => {
        if (requestId !== inboundRequestIdRef.current) return
        setInboundIsCalculating(false)
        setInbound((prev) => ({
          ...prev,
          address,
          distance,
          error,
        }))
      })
    },
    [recalculateDistance],
  )

  const hasDeliveryLegs =
    outbound.method === 'address' || inbound.method === 'address'

  const hasErrors = outbound.error !== null || inbound.error !== null
  const isCalculating = outboundIsCalculating || inboundIsCalculating

  return {
    outbound: { ...outbound, fee: fees.outboundFee },
    inbound: { ...inbound, fee: fees.returnFee },
    totalFee: fees.totalFee,
    hasDeliveryLegs,
    hasErrors,
    isCalculating,
    isDeliveryIncluded,
    setOutboundMethod,
    setInboundMethod,
    setOutboundLocationId,
    setInboundLocationId,
    setOutboundAddress,
    setInboundAddress,
  }
}
