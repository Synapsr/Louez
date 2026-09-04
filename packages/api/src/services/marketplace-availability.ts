import { and, eq, inArray } from "drizzle-orm";

import {
  buildReservationAvailabilityPredicate,
  buildReservationOverlapPredicate,
  db,
  getBlockingReservationStatuses,
  productUnits,
  products,
  reservationItems,
  reservations,
  storeMarketplaceChannels,
  stores,
} from "@louez/db";
import type { AvailabilityResponse, BookingAttributeAxis, StoreSettings } from "@louez/types";
import {
  getDeterministicCombinationSortValue,
  getProductCombinationAvailabilityKey,
  matchesSelectedAttributes,
  normalizeDaySchedule,
} from "@louez/utils";
import type { BookingAvailabilityInput, BookingCalendarInput } from "@louez/validations";

import {
  computeReservedNetOfExcludedUnits,
  getStorefrontAvailability,
  loadExcludedUnitInfo,
  normalizeTimezone,
  type ExcludedUnitInfo,
} from "./availability";
import { ApiServiceError } from "./errors";

const DAY_MS = 86_400_000;
const DEFAULT_MIN_RENTAL_MINUTES = 60;
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "18:00";
const MAX_CALENDAR_SPAN_DAYS = 93;

type MarketplaceAvailabilityReasonCode =
  | "channel_unpublished"
  | "closed"
  | "advance_notice"
  | "out_of_stock"
  | "min_duration"
  | "max_duration";

export interface MarketplaceBookingStore {
  id: string;
  slug: string;
  settings: StoreSettings | null;
  channelStatus: "setup_required" | "pending" | "published" | "paused" | "disabled" | null;
}

export interface CalendarReservation {
  status: string;
  startDate: Date;
  endDate: Date;
  items: Array<{
    productId: string | null;
    combinationKey?: string | null;
    quantity: number;
    assignedUnits: Array<{ productUnitId: string | null }>;
  }>;
}

export interface CalendarUnit {
  id: string;
  combinationKey: string;
  attributes: Record<string, string> | null;
  lifecycleStatus: "active" | "retired";
}

export interface CalendarProduct {
  id: string;
  quantity: number;
  trackUnits: boolean;
  bookingAttributeAxes: BookingAttributeAxis[] | null;
}

export interface CalendarInventory {
  product: CalendarProduct;
  reservations: CalendarReservation[];
  units: CalendarUnit[];
  unitInfo: ReadonlyMap<string, ExcludedUnitInfo>;
}

export interface MarketplaceAvailabilityDependencies {
  getAvailability: typeof getStorefrontAvailability;
  loadCalendarProduct: (params: {
    store: MarketplaceBookingStore;
    input: BookingCalendarInput;
  }) => Promise<CalendarProduct>;
  loadCalendarInventory: (params: {
    store: MarketplaceBookingStore;
    product: CalendarProduct;
    rangeStart: Date;
    rangeEnd: Date;
  }) => Promise<CalendarInventory>;
  loadStore: (storeId: string) => Promise<MarketplaceBookingStore>;
  now: () => Date;
}

/** Opening ranges of one day as the store writes them; `null` = no business hours configured. */
export type CalendarDayHours = Array<{ open: string; close: string }> | null;

interface CalendarDayWindow {
  date: string;
  open: boolean;
  closingTime: Date;
  ranges: Array<{ start: Date; end: Date }>;
  hours: CalendarDayHours;
}

export async function loadMarketplaceBookingStore(
  storeId: string,
): Promise<MarketplaceBookingStore> {
  const store = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      settings: stores.settings,
      channelStatus: storeMarketplaceChannels.status,
    })
    .from(stores)
    .leftJoin(storeMarketplaceChannels, eq(storeMarketplaceChannels.storeId, stores.id))
    .where(eq(stores.id, storeId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!store) throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  return store;
}

async function loadCalendarProduct(params: {
  store: MarketplaceBookingStore;
  input: BookingCalendarInput;
}): Promise<CalendarProduct> {
  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, params.input.productId),
      eq(products.storeId, params.store.id),
      eq(products.status, "active"),
    ),
    columns: {
      id: true,
      quantity: true,
      trackUnits: true,
      bookingAttributeAxes: true,
    },
  });

  if (!product) throw new ApiServiceError("NOT_FOUND", "errors.productNotFound");
  return product;
}

async function loadCalendarInventory(params: {
  store: MarketplaceBookingStore;
  product: CalendarProduct;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<CalendarInventory> {
  const turnoverBufferMinutes = params.store.settings?.turnoverBufferMinutes ?? 0;
  const blockingStatuses = getBlockingReservationStatuses(
    params.store.settings?.pendingBlocksAvailability ?? true,
  );
  const overlappingReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, params.store.id),
      inArray(reservations.status, blockingStatuses),
      buildReservationAvailabilityPredicate(db),
      buildReservationOverlapPredicate({
        start: params.rangeStart,
        end: params.rangeEnd,
        turnoverBufferMinutes,
      }),
    ),
    columns: {
      status: true,
      startDate: true,
      endDate: true,
    },
    with: {
      items: {
        where: eq(reservationItems.productId, params.product.id),
        columns: {
          productId: true,
          combinationKey: true,
          quantity: true,
        },
        with: {
          assignedUnits: {
            columns: {
              productUnitId: true,
            },
          },
        },
      },
    },
  });

  if (!params.product.trackUnits) {
    return {
      product: params.product,
      reservations: overlappingReservations,
      units: [],
      unitInfo: new Map(),
    };
  }

  const units = await db
    .select({
      id: productUnits.id,
      combinationKey: productUnits.combinationKey,
      attributes: productUnits.attributes,
      lifecycleStatus: productUnits.lifecycleStatus,
    })
    .from(productUnits)
    .where(eq(productUnits.productId, params.product.id));
  const unitInfo = await loadExcludedUnitInfo(db, new Set(units.map((unit) => unit.id)));

  return {
    product: params.product,
    reservations: overlappingReservations,
    units,
    unitInfo,
  };
}

const defaultDependencies: MarketplaceAvailabilityDependencies = {
  getAvailability: getStorefrontAvailability,
  loadCalendarInventory,
  loadCalendarProduct,
  loadStore: loadMarketplaceBookingStore,
  now: () => new Date(),
};

function uniqueProductIds(items: BookingAvailabilityInput["items"]): string[] {
  return [...new Set(items.map((item) => item.productId))];
}

function durationReasons(params: {
  endAt: string;
  productIds: string[];
  settings: StoreSettings | null;
  startAt: string;
}): Array<{ productId: string; code: MarketplaceAvailabilityReasonCode }> {
  const durationMinutes =
    (new Date(params.endAt).getTime() - new Date(params.startAt).getTime()) / 60_000;
  const reasons: Array<{ productId: string; code: MarketplaceAvailabilityReasonCode }> = [];
  const minMinutes = params.settings?.minRentalMinutes ?? DEFAULT_MIN_RENTAL_MINUTES;
  const maxMinutes = params.settings?.maxRentalMinutes;

  if (minMinutes > 0 && durationMinutes < minMinutes) {
    reasons.push(
      ...params.productIds.map((productId) => ({ productId, code: "min_duration" as const })),
    );
  }
  if (maxMinutes != null && durationMinutes > maxMinutes) {
    reasons.push(
      ...params.productIds.map((productId) => ({ productId, code: "max_duration" as const })),
    );
  }
  return reasons;
}

function attributesKey(attributes: Record<string, string> | undefined): string {
  if (!hasAttributeSelection(attributes)) return "";
  return Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
}

function availableQuantityForItem(
  item: BookingAvailabilityInput["items"][number],
  availability: AvailabilityResponse,
): number {
  const product = availability.products.find((candidate) => candidate.productId === item.productId);
  if (!product) return 0;
  if (!hasAttributeSelection(item.attributes) || !product.combinations?.length) {
    return product.availableQuantity;
  }

  return product.combinations
    .filter((combination) =>
      matchesSelectedAttributes(item.attributes, combination.selectedAttributes),
    )
    .reduce((sum, combination) => sum + combination.availableQuantity, 0);
}

function uniqueReasons(
  reasons: Array<{ productId: string; code: MarketplaceAvailabilityReasonCode }>,
): Array<{ productId: string; code: MarketplaceAvailabilityReasonCode }> {
  return [
    ...new Map(reasons.map((reason) => [`${reason.productId}:${reason.code}`, reason])).values(),
  ];
}

export async function availabilityMarketplaceBooking(
  params: { input: BookingAvailabilityInput },
  dependencies: MarketplaceAvailabilityDependencies = defaultDependencies,
): Promise<{
  computedAt: string;
  windows: Array<{
    startAt: string;
    endAt: string;
    available: boolean;
    reasons: Array<{ productId: string; code: MarketplaceAvailabilityReasonCode }>;
    items: Array<{ productId: string; availableQuantity: number }>;
  }>;
}> {
  const store = await dependencies.loadStore(params.input.storeId);
  const productIds = uniqueProductIds(params.input.items);
  const computedAt = dependencies.now().toISOString();

  if (store.channelStatus !== "published") {
    const reasons = productIds.map((productId) => ({
      productId,
      code: "channel_unpublished" as const,
    }));
    return {
      computedAt,
      windows: params.input.windows.map((window) => ({
        ...window,
        available: false,
        reasons,
        items: params.input.items.map((item) => ({
          productId: item.productId,
          availableQuantity: 0,
        })),
      })),
    };
  }

  const windows = await Promise.all(
    params.input.windows.map(async (window) => {
      const availability = await dependencies.getAvailability({
        storeSlug: store.slug,
        startDate: window.startAt,
        endDate: window.endAt,
        productIds,
      });
      const reasons = durationReasons({
        ...window,
        productIds,
        settings: store.settings,
      });

      if (availability.businessHoursValidation?.valid === false) {
        reasons.push(...productIds.map((productId) => ({ productId, code: "closed" as const })));
      }
      if (availability.advanceNoticeValidation?.valid === false) {
        reasons.push(
          ...productIds.map((productId) => ({ productId, code: "advance_notice" as const })),
        );
      }

      const requestedBySelection = new Map<string, number>();
      const requestedByProduct = new Map<string, number>();
      for (const item of params.input.items) {
        const selectionKey = `${item.productId}:${attributesKey(item.attributes)}`;
        requestedBySelection.set(
          selectionKey,
          (requestedBySelection.get(selectionKey) ?? 0) + item.quantity,
        );
        requestedByProduct.set(
          item.productId,
          (requestedByProduct.get(item.productId) ?? 0) + item.quantity,
        );
      }

      const responseItems = params.input.items.map((item) => ({
        productId: item.productId,
        availableQuantity: availableQuantityForItem(item, availability),
      }));
      for (const [index, item] of params.input.items.entries()) {
        const productAvailability = availability.products.find(
          (candidate) => candidate.productId === item.productId,
        );
        const requestedForSelection =
          requestedBySelection.get(`${item.productId}:${attributesKey(item.attributes)}`) ?? 0;
        const requestedForProduct = requestedByProduct.get(item.productId) ?? 0;
        if (
          requestedForSelection > responseItems[index].availableQuantity ||
          requestedForProduct > (productAvailability?.availableQuantity ?? 0)
        ) {
          reasons.push({ productId: item.productId, code: "out_of_stock" });
        }
      }

      const deduplicatedReasons = uniqueReasons(reasons);
      return {
        ...window,
        available: deduplicatedReasons.length === 0,
        reasons: deduplicatedReasons,
        items: responseItems,
      };
    }),
  );

  return { computedAt, windows };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function zonedDateTime(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  let candidateTimestamp = targetTimestamp;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidateTimestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((value) => value.type === type)?.value ?? 0);
    const representedTimestamp = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
    );
    candidateTimestamp += targetTimestamp - representedTimestamp;
  }

  return new Date(candidateTimestamp);
}

function dateKeys(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function weekday(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

function hasClosure(date: string, settings: StoreSettings | null): boolean {
  return Boolean(
    settings?.businessHours?.closurePeriods?.some(
      (period) => date >= period.startDate && date <= period.endDate,
    ),
  );
}

function calendarDayWindow(
  date: string,
  settings: StoreSettings | null,
  timezone: string,
): CalendarDayWindow {
  const nextDate = addDays(date, 1);
  const dayStart = zonedDateTime(date, "00:00", timezone);
  const dayEnd = zonedDateTime(nextDate, "00:00", timezone);
  const businessHours = settings?.businessHours;

  if (!businessHours?.enabled) {
    return {
      date,
      open: true,
      closingTime: dayEnd,
      ranges: [{ start: dayStart, end: dayEnd }],
      hours: null,
    };
  }

  const schedule = normalizeDaySchedule(
    businessHours.schedule[weekday(date)] as unknown as Record<string, unknown>,
  );
  const ranges = schedule.ranges.filter((range) => range.openTime < range.closeTime);
  if (!schedule.isOpen || ranges.length === 0 || hasClosure(date, settings)) {
    return { date, open: false, closingTime: dayEnd, ranges: [], hours: [] };
  }

  const openingRanges = ranges.map((range) => ({
    start: zonedDateTime(date, range.openTime, timezone),
    end: zonedDateTime(date, range.closeTime, timezone),
  }));
  return {
    date,
    open: true,
    closingTime: openingRanges[openingRanges.length - 1].end,
    ranges: openingRanges,
    hours: ranges.map((range) => ({ open: range.openTime, close: range.closeTime })),
  };
}

function defaultOpeningTimes(settings: StoreSettings | null): {
  defaultStartTime: string;
  defaultEndTime: string;
} {
  const businessHours = settings?.businessHours;
  if (!businessHours?.enabled) {
    return { defaultStartTime: DEFAULT_START_TIME, defaultEndTime: DEFAULT_END_TIME };
  }

  // Monday first: a Sunday-morning-only schedule must not set the week's defaults.
  for (const day of [1, 2, 3, 4, 5, 6, 0] as const) {
    const schedule = normalizeDaySchedule(
      businessHours.schedule[day] as unknown as Record<string, unknown>,
    );
    const ranges = schedule.ranges.filter((range) => range.openTime < range.closeTime);
    if (schedule.isOpen && ranges.length > 0) {
      return {
        defaultStartTime: ranges[0].openTime,
        defaultEndTime: ranges[ranges.length - 1].closeTime,
      };
    }
  }

  return { defaultStartTime: DEFAULT_START_TIME, defaultEndTime: DEFAULT_END_TIME };
}

function excludedUnitIdsForWindow(
  units: CalendarUnit[],
  unitInfo: ReadonlyMap<string, ExcludedUnitInfo>,
  start: Date,
  end: Date,
): Set<string> {
  return new Set(
    units
      .filter((unit) => {
        if (unit.lifecycleStatus !== "active") return true;
        return unitInfo
          .get(unit.id)
          ?.downtimes.some(
            (downtime) => downtime.startsAt < end && (!downtime.endsAt || downtime.endsAt > start),
          );
      })
      .map((unit) => unit.id),
  );
}

/** An absent or empty selection means "any combination", never a narrowed one. */
function hasAttributeSelection(
  attributes: Record<string, string> | undefined,
): attributes is Record<string, string> {
  return attributes !== undefined && Object.keys(attributes).length > 0;
}

function resolvedCombinationKey(
  inventory: CalendarInventory,
  attributes: Record<string, string> | undefined,
): string | null {
  if (!inventory.product.trackUnits || !hasAttributeSelection(attributes)) return null;

  const combinations = new Map<string, Record<string, string>>();
  for (const unit of inventory.units) {
    if (!combinations.has(unit.combinationKey)) {
      combinations.set(unit.combinationKey, unit.attributes ?? {});
    }
  }

  return (
    [...combinations.entries()]
      .filter(([, candidateAttributes]) =>
        matchesSelectedAttributes(attributes, candidateAttributes),
      )
      .sort(([, left], [, right]) =>
        getDeterministicCombinationSortValue(
          inventory.product.bookingAttributeAxes,
          left,
        ).localeCompare(
          getDeterministicCombinationSortValue(inventory.product.bookingAttributeAxes, right),
          "en",
        ),
      )[0]?.[0] ?? null
  );
}

function availableQuantityForRange(params: {
  inventory: CalendarInventory;
  start: Date;
  end: Date;
  turnoverBufferMinutes: number;
  combinationKey: string | null;
}): number {
  const excludedUnitIds = excludedUnitIdsForWindow(
    params.inventory.units,
    params.inventory.unitInfo,
    params.start,
    params.end,
  );
  const { reservedByProduct, reservedByProductCombination } = computeReservedNetOfExcludedUnits({
    reservations: params.inventory.reservations,
    startDate: params.start,
    endDate: params.end,
    turnoverBufferMinutes: params.turnoverBufferMinutes,
    excludedProductUnitIds: excludedUnitIds,
    excludedUnitInfo: params.inventory.unitInfo,
  });

  if (!params.inventory.product.trackUnits) {
    return Math.max(
      0,
      params.inventory.product.quantity - (reservedByProduct.get(params.inventory.product.id) ?? 0),
    );
  }

  const rentableUnits = params.inventory.units.filter(
    (unit) =>
      !excludedUnitIds.has(unit.id) &&
      (params.combinationKey === null || unit.combinationKey === params.combinationKey),
  );
  if (params.combinationKey === null) {
    return Math.max(
      0,
      rentableUnits.length - (reservedByProduct.get(params.inventory.product.id) ?? 0),
    );
  }

  const reserved =
    reservedByProductCombination.get(
      getProductCombinationAvailabilityKey(params.inventory.product.id, params.combinationKey),
    ) ?? 0;
  return Math.max(0, rentableUnits.length - reserved);
}

function availableQuantityForDay(params: {
  inventory: CalendarInventory;
  window: CalendarDayWindow;
  turnoverBufferMinutes: number;
  combinationKey: string | null;
}): number {
  if (!params.window.open || params.window.ranges.length === 0) return 0;
  return Math.min(
    ...params.window.ranges.map((range) =>
      availableQuantityForRange({
        inventory: params.inventory,
        start: range.start,
        end: range.end,
        turnoverBufferMinutes: params.turnoverBufferMinutes,
        combinationKey: params.combinationKey,
      }),
    ),
  );
}

function assertCalendarRange(input: BookingCalendarInput): void {
  const spanDays =
    (Date.parse(`${input.to}T00:00:00.000Z`) - Date.parse(`${input.from}T00:00:00.000Z`)) / DAY_MS;
  if (!Number.isInteger(spanDays) || spanDays < 0 || spanDays > MAX_CALENDAR_SPAN_DAYS) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
}

export async function calendarMarketplaceBooking(
  params: { input: BookingCalendarInput },
  dependencies: MarketplaceAvailabilityDependencies = defaultDependencies,
): Promise<{
  computedAt: string;
  timezone: string;
  rules: {
    minRentalMinutes: number;
    maxRentalMinutes: number | null;
    advanceNoticeMinutes: number;
    turnoverBufferMinutes: number;
    defaultStartTime: string;
    defaultEndTime: string;
  };
  days: Array<{
    date: string;
    open: boolean;
    withinNotice: boolean;
    availableQuantity: number;
    hours: CalendarDayHours;
  }>;
}> {
  assertCalendarRange(params.input);
  const store = await dependencies.loadStore(params.input.storeId);
  const computedAtDate = dependencies.now();
  const timezone = normalizeTimezone(store.settings?.timezone) ?? "UTC";
  const windows = dateKeys(params.input.from, params.input.to).map((date) =>
    calendarDayWindow(date, store.settings, timezone),
  );
  const turnoverBufferMinutes = store.settings?.turnoverBufferMinutes ?? 0;
  const advanceNoticeMinutes = store.settings?.advanceNoticeMinutes ?? 0;
  const noticeThreshold = new Date(computedAtDate.getTime() + advanceNoticeMinutes * 60_000);
  const openingTimes = defaultOpeningTimes(store.settings);
  const rules = {
    minRentalMinutes: store.settings?.minRentalMinutes ?? DEFAULT_MIN_RENTAL_MINUTES,
    maxRentalMinutes: store.settings?.maxRentalMinutes ?? null,
    advanceNoticeMinutes,
    turnoverBufferMinutes,
    ...openingTimes,
  };
  const product = await dependencies.loadCalendarProduct({
    store,
    input: params.input,
  });

  if (store.channelStatus !== "published") {
    return {
      computedAt: computedAtDate.toISOString(),
      timezone,
      rules,
      days: windows.map((window) => ({
        date: window.date,
        open: window.open,
        withinNotice: window.closingTime < noticeThreshold,
        availableQuantity: 0,
        hours: window.hours,
      })),
    };
  }

  const rangeStart = zonedDateTime(params.input.from, "00:00", timezone);
  const rangeEnd = zonedDateTime(addDays(params.input.to, 1), "00:00", timezone);
  const inventory = await dependencies.loadCalendarInventory({
    store,
    product,
    rangeStart,
    rangeEnd,
  });
  const combinationKey = resolvedCombinationKey(inventory, params.input.attributes);
  const hasUnresolvedCombination =
    inventory.product.trackUnits &&
    hasAttributeSelection(params.input.attributes) &&
    combinationKey === null;

  return {
    computedAt: computedAtDate.toISOString(),
    timezone,
    rules,
    days: windows.map((window) => ({
      date: window.date,
      open: window.open,
      withinNotice: window.closingTime < noticeThreshold,
      availableQuantity: hasUnresolvedCombination
        ? 0
        : availableQuantityForDay({
            inventory,
            window,
            turnoverBufferMinutes,
            combinationKey,
          }),
      hours: window.hours,
    })),
  };
}
