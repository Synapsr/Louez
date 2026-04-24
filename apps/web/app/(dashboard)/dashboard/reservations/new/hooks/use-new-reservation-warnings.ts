import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { isWithinBusinessHours, getDaySchedule, formatDaySchedule } from '@/lib/utils/business-hours'
import { dateRangesOverlap, getMinStartDateTime } from '@/lib/utils/duration'
import { formatDurationFromMinutes } from '@/lib/utils/rental-duration'

import type {
  AvailabilityWarning,
  PeriodWarning,
  Product,
  SelectedProduct,
  NewReservationFormProps,
} from '../types'
import {
  getProductCombinationAvailabilityKey,
  type ReservedByProductCombination,
} from '../utils/variant-lines'

interface UseNewReservationWarningsParams {
  startDate: Date | undefined
  endDate: Date | undefined
  selectedProducts: SelectedProduct[]
  products: Product[]
  businessHours: NewReservationFormProps['businessHours']
  advanceNoticeMinutes: number
  pendingBlocksAvailability: boolean
  existingReservations: NonNullable<NewReservationFormProps['existingReservations']>
}

export interface PeriodAvailability {
  reservedByProduct: Map<string, number>
  reservedByProductCombination: ReservedByProductCombination
}

export function getPeriodAvailability(params: {
  startDate: Date | undefined
  endDate: Date | undefined
  pendingBlocksAvailability: boolean
  existingReservations: NonNullable<NewReservationFormProps['existingReservations']>
}): PeriodAvailability {
  const { startDate, endDate, pendingBlocksAvailability, existingReservations } = params
  const reservedByProduct = new Map<string, number>()
  const reservedByProductCombination: ReservedByProductCombination = new Map()
  const blockingStatuses = pendingBlocksAvailability
    ? ['pending', 'confirmed', 'ongoing']
    : ['confirmed', 'ongoing']

  if (!startDate || !endDate) {
    return { reservedByProduct, reservedByProductCombination }
  }

  for (const reservation of existingReservations) {
    if (!blockingStatuses.includes(reservation.status)) {
      continue
    }

    if (!dateRangesOverlap(reservation.startDate, reservation.endDate, startDate, endDate)) {
      continue
    }

    for (const item of reservation.items) {
      if (!item.productId) continue

      const current = reservedByProduct.get(item.productId) || 0
      reservedByProduct.set(item.productId, current + item.quantity)

      const combinationMapKey = getProductCombinationAvailabilityKey(
        item.productId,
        item.combinationKey,
      )
      const currentCombination = reservedByProductCombination.get(combinationMapKey) || 0
      reservedByProductCombination.set(combinationMapKey, currentCombination + item.quantity)
    }
  }

  return { reservedByProduct, reservedByProductCombination }
}

export function useNewReservationWarnings({
  startDate,
  endDate,
  selectedProducts,
  products,
  businessHours,
  advanceNoticeMinutes,
  pendingBlocksAvailability,
  existingReservations,
}: UseNewReservationWarningsParams) {
  const t = useTranslations('dashboard.reservations.manualForm')

  const minDateTime = useMemo(
    () => getMinStartDateTime(advanceNoticeMinutes),
    [advanceNoticeMinutes]
  )

  const periodWarnings = useMemo<PeriodWarning[]>(() => {
    const warnings: PeriodWarning[] = []

    if (startDate) {
      if (startDate < minDateTime) {
        warnings.push({
          type: 'advance_notice',
          field: 'start',
          message: t('warnings.advanceNotice'),
          details: t('warnings.advanceNoticeDetails', {
            duration: formatDurationFromMinutes(advanceNoticeMinutes),
          }),
        })
      }

      if (businessHours?.enabled) {
        const startCheck = isWithinBusinessHours(startDate, businessHours)
        if (!startCheck.valid) {
          if (startCheck.reason === 'day_closed') {
            warnings.push({
              type: 'day_closed',
              field: 'start',
              message: t('warnings.startDayClosed'),
              details: t('warnings.dayClosedDetails'),
            })
          } else if (startCheck.reason === 'outside_hours') {
            const startDaySchedule = getDaySchedule(startDate, businessHours)
            warnings.push({
              type: 'outside_hours',
              field: 'start',
              message: t('warnings.startOutsideHours'),
              details: t('warnings.outsideHoursDetails', {
                hours: formatDaySchedule(startDaySchedule),
              }),
            })
          } else if (startCheck.reason === 'closure_period' && startCheck.closurePeriod) {
            warnings.push({
              type: 'closure_period',
              field: 'start',
              message: t('warnings.startClosurePeriod'),
              details: startCheck.closurePeriod.name || t('warnings.closurePeriodDetails'),
            })
          }
        }
      }
    }

    if (endDate && businessHours?.enabled) {
      const endCheck = isWithinBusinessHours(endDate, businessHours)
      if (!endCheck.valid) {
        if (endCheck.reason === 'day_closed') {
          warnings.push({
            type: 'day_closed',
            field: 'end',
            message: t('warnings.endDayClosed'),
            details: t('warnings.dayClosedDetails'),
          })
        } else if (endCheck.reason === 'outside_hours') {
          const endDaySchedule = getDaySchedule(endDate, businessHours)
          warnings.push({
            type: 'outside_hours',
            field: 'end',
            message: t('warnings.endOutsideHours'),
            details: t('warnings.outsideHoursDetails', {
              hours: formatDaySchedule(endDaySchedule),
            }),
          })
        } else if (endCheck.reason === 'closure_period' && endCheck.closurePeriod) {
          warnings.push({
            type: 'closure_period',
            field: 'end',
            message: t('warnings.endClosurePeriod'),
            details: endCheck.closurePeriod.name || t('warnings.closurePeriodDetails'),
          })
        }
      }
    }

    return warnings
  }, [advanceNoticeMinutes, businessHours, endDate, minDateTime, startDate, t])

  const availabilityWarnings = useMemo<AvailabilityWarning[]>(() => {
    if (!startDate || !endDate || selectedProducts.length === 0) {
      return []
    }

    const warnings: AvailabilityWarning[] = []
    const { reservedByProduct } = getPeriodAvailability({
      startDate,
      endDate,
      pendingBlocksAvailability,
      existingReservations,
    })

    const requestedByProduct = new Map<string, number>()
    for (const selectedItem of selectedProducts) {
      const current = requestedByProduct.get(selectedItem.productId) || 0
      requestedByProduct.set(selectedItem.productId, current + selectedItem.quantity)
    }

    for (const [productId, requestedQuantity] of requestedByProduct.entries()) {
      const product = products.find((p) => p.id === productId)
      if (!product) continue

      const reserved = reservedByProduct.get(productId) || 0
      const available = Math.max(0, product.quantity - reserved)

      if (requestedQuantity > available) {
        warnings.push({
          productId,
          productName: product.name,
          requestedQuantity,
          availableQuantity: available,
          conflictingReservations: reserved,
        })
      }
    }

    return warnings
  }, [
    endDate,
    existingReservations,
    pendingBlocksAvailability,
    products,
    selectedProducts,
    startDate,
  ])

  return {
    periodWarnings,
    availabilityWarnings,
  }
}
