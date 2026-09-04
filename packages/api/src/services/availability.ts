import { and, eq, inArray } from 'drizzle-orm';

import {
  buildReservationOverlapPredicate,
  buildReservationAvailabilityPredicate,
  buildUnitRentableDuringPredicate,
  db,
  type Database,
  getBlockingReservationStatuses,
  loadConsumableReservedQuantities,
  productUnitDowntimes,
  productUnits,
  productAccessories,
  products,
  reservations,
  stores,
} from '@louez/db';
import type {
  AvailabilityResponse,
  BookingAttributeAxis,
  BusinessHours,
  CombinationAvailability,
  ProductAvailability,
  StockKind,
  UnitAttributes,
} from '@louez/types';
import {
  DEFAULT_COMBINATION_KEY,
  calculatePeakReservedQuantities,
  divideStockQuantityLimit,
  getAvailableStockQuantity,
  getDeterministicCombinationSortValue,
  getProductCombinationAvailabilityKey,
  normalizeDaySchedule,
} from '@louez/utils';

import { ApiServiceError } from './errors';

type ReservationWithAssignedUnits = {
  status: string;
  startDate: Date;
  endDate: Date;
  items: Array<{
    productId: string | null;
    combinationKey?: string | null;
    quantity: number;
    assignedUnits: Array<{ productUnitId: string | null }>;
  }>;
};

export type ExcludedUnitInfo = {
  lifecycleStatus: 'active' | 'retired';
  downtimes: Array<{ startsAt: Date; endsAt: Date | null }>;
};

function downtimeOverlaps(
  downtime: { startsAt: Date; endsAt: Date | null },
  startDate: Date,
  endDate: Date,
) {
  return (
    downtime.startsAt < endDate &&
    (!downtime.endsAt || downtime.endsAt > startDate)
  );
}

function excludedUnitAbsorbsReservation(params: {
  reservation: ReservationWithAssignedUnits;
  unitInfo: ExcludedUnitInfo | undefined;
}) {
  if (params.reservation.status === 'ongoing') {
    return true;
  }

  if (!params.unitInfo || params.unitInfo.lifecycleStatus !== 'active') {
    return false;
  }

  return !params.unitInfo.downtimes.some((downtime) =>
    downtimeOverlaps(
      downtime,
      params.reservation.startDate,
      params.reservation.endDate,
    ),
  );
}

export async function loadExcludedUnitInfo(
  database: Pick<Database, 'select'>,
  excludedProductUnitIds: ReadonlySet<string>,
): Promise<Map<string, ExcludedUnitInfo>> {
  if (excludedProductUnitIds.size === 0) {
    return new Map();
  }

  const unitIds = [...excludedProductUnitIds];
  const unitRows = await database
    .select({
      id: productUnits.id,
      lifecycleStatus: productUnits.lifecycleStatus,
    })
    .from(productUnits)
    .where(inArray(productUnits.id, unitIds));
  const downtimeRows = await database
    .select({
      productUnitId: productUnitDowntimes.productUnitId,
      startsAt: productUnitDowntimes.startsAt,
      endsAt: productUnitDowntimes.endsAt,
    })
    .from(productUnitDowntimes)
    .where(inArray(productUnitDowntimes.productUnitId, unitIds));
  const infoByUnitId = new Map<string, ExcludedUnitInfo>();

  for (const unit of unitRows) {
    infoByUnitId.set(unit.id, {
      lifecycleStatus: unit.lifecycleStatus,
      downtimes: [],
    });
  }

  for (const downtime of downtimeRows) {
    const unitInfo = infoByUnitId.get(downtime.productUnitId);
    if (!unitInfo) {
      continue;
    }

    unitInfo.downtimes.push({
      startsAt: downtime.startsAt,
      endsAt: downtime.endsAt,
    });
  }

  return infoByUnitId;
}

export function computeReservedNetOfExcludedUnits(params: {
  reservations: ReservationWithAssignedUnits[];
  startDate: Date;
  endDate: Date;
  turnoverBufferMinutes: number;
  excludedProductUnitIds: ReadonlySet<string>;
  excludedUnitInfo: ReadonlyMap<string, ExcludedUnitInfo>;
  consumableProductIds?: ReadonlySet<string>;
}): {
  reservedByProduct: Map<string, number>;
  reservedByProductCombination: Map<string, number>;
} {
  const reservations = params.reservations.map((reservation) => ({
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    items: reservation.items.flatMap((item) => {
      const excludedAssignedUnitCount = item.assignedUnits.filter(
        (unit) =>
          unit.productUnitId &&
          params.excludedProductUnitIds.has(unit.productUnitId) &&
          excludedUnitAbsorbsReservation({
            reservation,
            unitInfo: params.excludedUnitInfo.get(unit.productUnitId),
          }),
      ).length;
      const quantity = Math.max(
        0,
        item.quantity - Math.min(item.quantity, excludedAssignedUnitCount),
      );

      if (quantity === 0) {
        return [];
      }

      const stockKind: StockKind =
        item.productId && params.consumableProductIds?.has(item.productId)
          ? 'consumable'
          : 'returnable';

      return [
        {
          productId: item.productId,
          combinationKey: item.combinationKey,
          quantity,
          stockKind,
          consumedQuantity: 0,
        },
      ];
    }),
  }));

  return calculatePeakReservedQuantities({
    reservations,
    startDate: params.startDate,
    endDate: params.endDate,
    turnoverBufferMinutes: params.turnoverBufferMinutes,
  });
}

const WEEKDAY_INDEX: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function normalizeTimezone(timezone: unknown): string | undefined {
  if (typeof timezone !== 'string') {
    return undefined;
  }

  const normalizedTimezone = timezone.trim();
  if (!normalizedTimezone) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimezone }).format(
      new Date(),
    );
    return normalizedTimezone;
  } catch {
    return undefined;
  }
}

function getMinStartDateTime(advanceNoticeMinutes: number = 0): Date {
  return new Date(Date.now() + advanceNoticeMinutes * 60 * 1000);
}

function getDateKeyInTimezone(date: Date, timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getWeekdayAndTimeInTimezone(
  date: Date,
  timezone?: string,
): { weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekdayLabel = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';

  return {
    weekday: WEEKDAY_INDEX[weekdayLabel] ?? 0,
    time: `${hour}:${minute}`,
  };
}

function getClosureReason(
  date: Date,
  businessHours: BusinessHours,
  timezone?: string,
): 'closure_period' | null {
  if (!businessHours.closurePeriods?.length) {
    return null;
  }

  const dayKey = getDateKeyInTimezone(date, timezone);
  const { time } = getWeekdayAndTimeInTimezone(date, timezone);

  for (const period of businessHours.closurePeriods) {
    if (!period.startDate || !period.endDate) {
      continue;
    }

    if (dayKey >= period.startDate && dayKey <= period.endDate) {
      if (period.startTime && period.endTime) {
        if (time >= period.startTime && time <= period.endTime) {
          return 'closure_period';
        }

        continue;
      }

      return 'closure_period';
    }
  }

  return null;
}

function validateDateTimeInBusinessHours(
  date: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string,
): {
  valid: boolean;
  reason?: 'closure_period' | 'day_closed' | 'outside_hours';
} {
  if (!businessHours?.enabled) {
    return { valid: true };
  }

  const closureReason = getClosureReason(date, businessHours, timezone);
  if (closureReason) {
    return { valid: false, reason: closureReason };
  }

  const { weekday, time } = getWeekdayAndTimeInTimezone(date, timezone);
  const schedule = normalizeDaySchedule(
    businessHours.schedule[weekday] as unknown as Record<string, unknown>,
  );

  if (!schedule.isOpen) {
    return { valid: false, reason: 'day_closed' };
  }

  const inRange = schedule.ranges.some(
    (r) => time >= r.openTime && time <= r.closeTime,
  );

  if (!inRange) {
    return { valid: false, reason: 'outside_hours' };
  }

  return { valid: true };
}

function validateRentalPeriod(
  startDate: Date,
  endDate: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string,
) {
  if (!businessHours?.enabled) {
    return { valid: true, errors: [] as string[] };
  }

  const errors: string[] = [];

  const pickup = validateDateTimeInBusinessHours(
    startDate,
    businessHours,
    timezone,
  );
  if (!pickup.valid && pickup.reason) {
    errors.push(`pickup_${pickup.reason}`);
  }

  const dropoff = validateDateTimeInBusinessHours(
    endDate,
    businessHours,
    timezone,
  );
  if (!dropoff.valid && dropoff.reason) {
    errors.push(`return_${dropoff.reason}`);
  }

  return { valid: errors.length === 0, errors };
}

interface GetStorefrontAvailabilityParams {
  storeSlug: string;
  startDate: string;
  endDate: string;
  productIds?: string[];
}

export async function getStorefrontAvailability(
  params: GetStorefrontAvailabilityParams,
): Promise<AvailabilityResponse> {
  const {
    storeSlug,
    startDate: startDateStr,
    endDate: endDateStr,
    productIds,
  } = params;

  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData');
  }

  if (endDate <= startDate) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData');
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  });

  if (!store) {
    throw new ApiServiceError('NOT_FOUND', 'errors.storeNotFound');
  }

  const timezone = normalizeTimezone(store.settings?.timezone);

  const businessHoursValidation = validateRentalPeriod(
    startDate,
    endDate,
    store.settings?.businessHours,
    timezone,
  );

  const advanceNoticeMinutes = store.settings?.advanceNoticeMinutes || 0;
  const minimumStartTime = getMinStartDateTime(advanceNoticeMinutes);
  const advanceNoticeValidation = {
    valid: startDate >= minimumStartTime,
    minimumStartTime: minimumStartTime.toISOString(),
    advanceNoticeMinutes,
  };

  const productsWhere = productIds?.length
    ? and(
        eq(products.storeId, store.id),
        eq(products.status, 'active'),
        inArray(products.id, productIds),
      )
    : and(eq(products.storeId, store.id), eq(products.status, 'active'));

  const storeProducts = await db.query.products.findMany({
    where: productsWhere,
  });

  if (storeProducts.length === 0) {
    return {
      products: [],
      period: { startDate: startDateStr, endDate: endDateStr },
      businessHoursValidation,
      advanceNoticeValidation,
    };
  }

  const requestedProductIds = storeProducts.map((product) => product.id);
  const requiredAccessoryLinks = await db
    .select({
      parentProductId: productAccessories.productId,
      accessoryProductId: productAccessories.accessoryId,
      quantity: productAccessories.quantity,
    })
    .from(productAccessories)
    .innerJoin(products, eq(productAccessories.productId, products.id))
    .where(
      and(
        eq(products.storeId, store.id),
        eq(productAccessories.required, true),
        inArray(productAccessories.productId, requestedProductIds),
      ),
    );
  const requestedProductIdSet = new Set(requestedProductIds);
  const additionalAccessoryIds = [
    ...new Set(
      requiredAccessoryLinks
        .map((link) => link.accessoryProductId)
        .filter((productId) => !requestedProductIdSet.has(productId)),
    ),
  ];
  const additionalAccessoryProducts =
    additionalAccessoryIds.length > 0
      ? await db.query.products.findMany({
          where: and(
            eq(products.storeId, store.id),
            eq(products.status, 'active'),
            inArray(products.id, additionalAccessoryIds),
          ),
        })
      : [];
  const productsForAvailability = [
    ...storeProducts,
    ...additionalAccessoryProducts,
  ];

  const turnoverBufferMinutes = store.settings?.turnoverBufferMinutes ?? 0;
  const blockingStatuses = getBlockingReservationStatuses(
    store.settings?.pendingBlocksAvailability ?? true,
  );

  const overlappingReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, store.id),
      inArray(reservations.status, blockingStatuses),
      buildReservationAvailabilityPredicate(db),
      buildReservationOverlapPredicate({
        start: startDate,
        end: endDate,
        turnoverBufferMinutes,
      }),
    ),
    with: {
      items: {
        with: {
          assignedUnits: true,
        },
      },
    },
  });

  const trackedProductIds = productsForAvailability
    .filter((product) => product.trackUnits)
    .map((product) => product.id);
  const trackedUnits =
    trackedProductIds.length > 0
      ? await db
          .select({
            id: productUnits.id,
          })
          .from(productUnits)
          .where(inArray(productUnits.productId, trackedProductIds))
      : [];
  const availableUnits =
    trackedProductIds.length > 0
      ? await db
          .select({
            id: productUnits.id,
            productId: productUnits.productId,
            combinationKey: productUnits.combinationKey,
            attributes: productUnits.attributes,
          })
          .from(productUnits)
          .where(
            and(
              inArray(productUnits.productId, trackedProductIds),
              buildUnitRentableDuringPredicate(db, startDate, endDate),
            ),
          )
      : [];
  const availableUnitIds = new Set(availableUnits.map((unit) => unit.id));
  const excludedProductUnitIds = new Set(
    trackedUnits
      .filter((unit) => !availableUnitIds.has(unit.id))
      .map((unit) => unit.id),
  );
  const excludedUnitInfo = await loadExcludedUnitInfo(
    db,
    excludedProductUnitIds,
  );

  const { reservedByProduct, reservedByProductCombination } =
    computeReservedNetOfExcludedUnits({
      reservations: overlappingReservations,
      startDate,
      endDate,
      turnoverBufferMinutes,
      excludedProductUnitIds,
      excludedUnitInfo,
      consumableProductIds: new Set(
        productsForAvailability
          .filter((product) => product.stockKind === 'consumable')
          .map((product) => product.id),
      ),
    });
  const consumableReservedByProduct = await loadConsumableReservedQuantities(
    db,
    {
      storeId: store.id,
      productIds: productsForAvailability
        .filter((product) => product.stockKind === 'consumable')
        .map((product) => product.id),
      blockingStatuses,
    },
  );
  for (const [productId, reservedQuantity] of consumableReservedByProduct) {
    reservedByProduct.set(productId, reservedQuantity);
  }

  const combinationsByProduct = new Map<
    string,
    Map<string, { totalQuantity: number; selectedAttributes: UnitAttributes }>
  >();

  for (const unit of availableUnits) {
    const productMap = combinationsByProduct.get(unit.productId) || new Map();
    const combinationKey = unit.combinationKey || DEFAULT_COMBINATION_KEY;
    const current = productMap.get(combinationKey);

    if (!current) {
      productMap.set(combinationKey, {
        totalQuantity: 1,
        selectedAttributes: (unit.attributes || {}) as UnitAttributes,
      });
    } else {
      current.totalQuantity += 1;
      if (
        Object.keys(current.selectedAttributes).length === 0 &&
        unit.attributes
      ) {
        current.selectedAttributes = unit.attributes as UnitAttributes;
      }
      productMap.set(combinationKey, current);
    }

    combinationsByProduct.set(unit.productId, productMap);
  }

  const productAvailability: ProductAvailability[] =
    productsForAvailability.map((product) => {
      if (!product.trackUnits) {
        const reservedQuantity = reservedByProduct.get(product.id) || 0;
        const availableQuantity = getAvailableStockQuantity({
          stockKind: product.stockKind,
          totalQuantity: product.quantity,
          reservedQuantity,
        });

        let status: ProductAvailability['status'] = 'available';
        if (availableQuantity === 0) {
          status = 'unavailable';
        } else if (
          availableQuantity !== null &&
          availableQuantity < product.quantity
        ) {
          status = 'limited';
        }

        return {
          productId: product.id,
          totalQuantity:
            product.stockKind === 'untracked' ? null : product.quantity,
          reservedQuantity:
            product.stockKind === 'untracked' ? 0 : reservedQuantity,
          availableQuantity,
          status,
          ...(product.stockKind === 'consumable' && availableQuantity === 0
            ? { reason: 'out_of_stock' }
            : {}),
        };
      }

      const productCombinations =
        combinationsByProduct.get(product.id) || new Map();
      const axes = Array.isArray(product.bookingAttributeAxes)
        ? (product.bookingAttributeAxes as BookingAttributeAxis[])
        : [];
      const combinations: CombinationAvailability[] = [];

      let totalQuantity = 0;
      for (const [
        combinationKey,
        combinationData,
      ] of productCombinations.entries()) {
        const reservedQuantity =
          reservedByProductCombination.get(
            getProductCombinationAvailabilityKey(product.id, combinationKey),
          ) || 0;
        const availableQuantity = Math.max(
          0,
          combinationData.totalQuantity - reservedQuantity,
        );

        totalQuantity += combinationData.totalQuantity;

        let status: CombinationAvailability['status'] = 'available';
        if (availableQuantity === 0) {
          status = 'unavailable';
        } else if (availableQuantity < combinationData.totalQuantity) {
          status = 'limited';
        }

        combinations.push({
          combinationKey,
          selectedAttributes: combinationData.selectedAttributes || {},
          totalQuantity: combinationData.totalQuantity,
          reservedQuantity,
          availableQuantity,
          status,
        });
      }

      combinations.sort((a, b) => {
        const sortA = getDeterministicCombinationSortValue(
          axes,
          a.selectedAttributes,
        );
        const sortB = getDeterministicCombinationSortValue(
          axes,
          b.selectedAttributes,
        );
        return sortA.localeCompare(sortB, 'en');
      });
      const combinationsByKey = Object.fromEntries(
        combinations.map((combination) => [
          combination.combinationKey,
          combination,
        ]),
      );

      const reservedQuantity = reservedByProduct.get(product.id) || 0;
      const availableQuantity = Math.max(0, totalQuantity - reservedQuantity);

      let status: ProductAvailability['status'] = 'available';
      if (availableQuantity === 0) {
        status = 'unavailable';
      } else if (availableQuantity < totalQuantity) {
        status = 'limited';
      }

      return {
        productId: product.id,
        totalQuantity,
        reservedQuantity,
        availableQuantity,
        status,
        combinations,
        combinationsByKey,
      };
    });

  const availabilityByProductId = new Map(
    productAvailability.map((availability) => [
      availability.productId,
      availability,
    ]),
  );
  for (const link of requiredAccessoryLinks) {
    const parentAvailability = availabilityByProductId.get(
      link.parentProductId,
    );
    const accessoryAvailability = availabilityByProductId.get(
      link.accessoryProductId,
    );
    if (!parentAvailability || !accessoryAvailability) {
      if (parentAvailability) {
        parentAvailability.availableQuantity = 0;
        parentAvailability.status = 'unavailable';
        parentAvailability.reason = 'required_accessory_out_of_stock';
      }
      continue;
    }

    const requiredPerParent = Math.max(1, link.quantity);
    const accessoryCapacity = divideStockQuantityLimit(
      accessoryAvailability.availableQuantity,
      requiredPerParent,
    );
    if (
      accessoryCapacity === null ||
      (parentAvailability.availableQuantity !== null &&
        accessoryCapacity >= parentAvailability.availableQuantity)
    ) {
      continue;
    }

    parentAvailability.availableQuantity = accessoryCapacity;
    parentAvailability.status =
      accessoryCapacity === 0 ? 'unavailable' : 'limited';
    if (accessoryCapacity === 0) {
      parentAvailability.reason = 'required_accessory_out_of_stock';
    }
  }

  return {
    products: productAvailability.filter((availability) =>
      requestedProductIdSet.has(availability.productId),
    ),
    period: { startDate: startDateStr, endDate: endDateStr },
    businessHoursValidation,
    advanceNoticeValidation,
  };
}
