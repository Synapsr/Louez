import { useMemo } from 'react';

import { useTranslations } from 'next-intl';

import type { ProductAvailability } from '@louez/types';
import { calculatePeakReservedQuantities } from '@louez/utils';

import {
  formatDaySchedule,
  getDaySchedule,
  isWithinBusinessHours,
} from '@/lib/utils/business-hours';
import { getMinStartDateTime } from '@/lib/utils/duration';
import { formatDurationFromMinutes } from '@/lib/utils/rental-duration';

import type {
  AvailabilityWarning,
  NewReservationFormProps,
  PeriodWarning,
  Product,
  SelectedProduct,
} from '../types';
import type { ReservedByProductCombination } from '../utils/variant-lines';

interface UseNewReservationWarningsParams {
  startDate: Date | undefined;
  endDate: Date | undefined;
  selectedProducts: SelectedProduct[];
  products: Product[];
  businessHours: NewReservationFormProps['businessHours'];
  advanceNoticeMinutes: number;
  pendingBlocksAvailability: boolean;
  turnoverBufferMinutes: number;
  existingReservations: NonNullable<
    NewReservationFormProps['existingReservations']
  >;
  serviceAvailability?: ProductAvailability[];
}

export interface PeriodAvailability {
  reservedByProduct: Map<string, number>;
  reservedByProductCombination: ReservedByProductCombination;
  productsById: Map<string, ProductAvailability>;
}

export function getPeriodAvailability(params: {
  startDate: Date | undefined;
  endDate: Date | undefined;
  pendingBlocksAvailability: boolean;
  turnoverBufferMinutes?: number;
  existingReservations: NonNullable<
    NewReservationFormProps['existingReservations']
  >;
  serviceAvailability?: ProductAvailability[];
}): PeriodAvailability {
  const {
    startDate,
    endDate,
    pendingBlocksAvailability,
    turnoverBufferMinutes = 0,
    existingReservations,
  } = params;
  const reservedByProduct = new Map<string, number>();
  const reservedByProductCombination: ReservedByProductCombination = new Map();
  const productsById = new Map(
    (params.serviceAvailability ?? []).map((product) => [
      product.productId,
      product,
    ]),
  );
  const blockingStatuses = ['confirmed', 'ongoing'];
  if (pendingBlocksAvailability) {
    blockingStatuses.unshift('pending');
  }

  if (!startDate || !endDate) {
    return { reservedByProduct, reservedByProductCombination, productsById };
  }

  const peakAvailability = calculatePeakReservedQuantities({
    reservations: existingReservations.filter((reservation) =>
      blockingStatuses.includes(reservation.status),
    ),
    startDate,
    endDate,
    turnoverBufferMinutes,
  });

  peakAvailability.reservedByProduct.forEach((quantity, productId) => {
    reservedByProduct.set(productId, quantity);
  });
  peakAvailability.reservedByProductCombination.forEach(
    (quantity, combinationKey) => {
      reservedByProductCombination.set(combinationKey, quantity);
    },
  );

  return { reservedByProduct, reservedByProductCombination, productsById };
}

export function useNewReservationWarnings({
  startDate,
  endDate,
  selectedProducts,
  products,
  businessHours,
  advanceNoticeMinutes,
  pendingBlocksAvailability,
  turnoverBufferMinutes,
  existingReservations,
  serviceAvailability,
}: UseNewReservationWarningsParams) {
  const t = useTranslations('dashboard.reservations.manualForm');

  const minDateTime = useMemo(
    () => getMinStartDateTime(advanceNoticeMinutes),
    [advanceNoticeMinutes],
  );

  const periodWarnings = useMemo<PeriodWarning[]>(() => {
    const warnings: PeriodWarning[] = [];

    if (startDate) {
      if (startDate < minDateTime) {
        warnings.push({
          type: 'advance_notice',
          field: 'start',
          message: t('warnings.advanceNotice'),
          details: t('warnings.advanceNoticeDetails', {
            duration: formatDurationFromMinutes(advanceNoticeMinutes),
          }),
        });
      }

      if (businessHours?.enabled) {
        const startCheck = isWithinBusinessHours(startDate, businessHours);
        if (!startCheck.valid) {
          if (startCheck.reason === 'day_closed') {
            warnings.push({
              type: 'day_closed',
              field: 'start',
              message: t('warnings.startDayClosed'),
              details: t('warnings.dayClosedDetails'),
            });
          } else if (startCheck.reason === 'outside_hours') {
            const startDaySchedule = getDaySchedule(startDate, businessHours);
            warnings.push({
              type: 'outside_hours',
              field: 'start',
              message: t('warnings.startOutsideHours'),
              details: t('warnings.outsideHoursDetails', {
                hours: formatDaySchedule(startDaySchedule),
              }),
            });
          } else if (
            startCheck.reason === 'closure_period' &&
            startCheck.closurePeriod
          ) {
            warnings.push({
              type: 'closure_period',
              field: 'start',
              message: t('warnings.startClosurePeriod'),
              details:
                startCheck.closurePeriod.name ||
                t('warnings.closurePeriodDetails'),
            });
          }
        }
      }
    }

    if (endDate && businessHours?.enabled) {
      const endCheck = isWithinBusinessHours(endDate, businessHours);
      if (!endCheck.valid) {
        if (endCheck.reason === 'day_closed') {
          warnings.push({
            type: 'day_closed',
            field: 'end',
            message: t('warnings.endDayClosed'),
            details: t('warnings.dayClosedDetails'),
          });
        } else if (endCheck.reason === 'outside_hours') {
          const endDaySchedule = getDaySchedule(endDate, businessHours);
          warnings.push({
            type: 'outside_hours',
            field: 'end',
            message: t('warnings.endOutsideHours'),
            details: t('warnings.outsideHoursDetails', {
              hours: formatDaySchedule(endDaySchedule),
            }),
          });
        } else if (
          endCheck.reason === 'closure_period' &&
          endCheck.closurePeriod
        ) {
          warnings.push({
            type: 'closure_period',
            field: 'end',
            message: t('warnings.endClosurePeriod'),
            details:
              endCheck.closurePeriod.name || t('warnings.closurePeriodDetails'),
          });
        }
      }
    }

    return warnings;
  }, [advanceNoticeMinutes, businessHours, endDate, minDateTime, startDate, t]);

  const availabilityWarnings = useMemo<AvailabilityWarning[]>(() => {
    if (!startDate || !endDate || selectedProducts.length === 0) {
      return [];
    }

    const warnings: AvailabilityWarning[] = [];
    const { reservedByProduct } = getPeriodAvailability({
      startDate,
      endDate,
      pendingBlocksAvailability,
      turnoverBufferMinutes,
      existingReservations,
      serviceAvailability,
    });
    const productsById = new Map(
      (serviceAvailability ?? []).map((product) => [
        product.productId,
        product,
      ]),
    );

    const requestedByProduct = new Map<string, number>();
    for (const selectedItem of selectedProducts) {
      const current = requestedByProduct.get(selectedItem.productId) || 0;
      requestedByProduct.set(
        selectedItem.productId,
        current + selectedItem.quantity,
      );
    }

    for (const [productId, requestedQuantity] of requestedByProduct.entries()) {
      const product = products.find((p) => p.id === productId);
      if (!product) continue;

      const serviceProduct = productsById.get(productId);
      const reserved =
        serviceProduct?.reservedQuantity ??
        reservedByProduct.get(productId) ??
        0;
      const available = serviceProduct
        ? serviceProduct.availableQuantity
        : Math.max(0, product.quantity - reserved);

      if (requestedQuantity > available) {
        warnings.push({
          productId,
          productName: product.name,
          requestedQuantity,
          availableQuantity: available,
          conflictingReservations: reserved,
          turnoverBufferMinutes,
        });
      }
    }

    return warnings;
  }, [
    endDate,
    existingReservations,
    pendingBlocksAvailability,
    products,
    serviceAvailability,
    selectedProducts,
    startDate,
    turnoverBufferMinutes,
  ]);

  return {
    periodWarnings,
    availabilityWarnings,
  };
}
