import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";

import type { AvailabilityResponse, BusinessHours, StoreSettings } from "@louez/types";

import { ApiServiceError } from "./errors";
import type {
  CalendarInventory,
  MarketplaceAvailabilityDependencies,
  MarketplaceBookingStore,
} from "./marketplace-availability";

const require = createRequire(import.meta.url);
const availabilityUtils: Record<string, unknown> = require("@louez/utils");

mock.module("@louez/utils", { namedExports: availabilityUtils });
mock.module("@louez/db", {
  namedExports: {
    buildReservationAvailabilityPredicate: () => undefined,
    buildReservationOverlapPredicate: () => undefined,
    buildUnitRentableDuringPredicate: () => undefined,
    db: {},
    getBlockingReservationStatuses: () => ["pending", "confirmed", "ongoing"],
    productUnitDowntimes: {},
    productUnits: {},
    products: {},
    reservationItems: {},
    reservations: {},
    storeMarketplaceChannels: {},
    stores: {},
  },
});

const { availabilityMarketplaceBooking, calendarMarketplaceBooking } =
  await import("./marketplace-availability");

const storeId = "store0000000000000000";
const productId = "product00000000000000";

function businessHours(overrides?: Partial<BusinessHours["schedule"]>): BusinessHours {
  const closed = { isOpen: false, ranges: [] };
  const open = { isOpen: true, ranges: [{ openTime: "09:00", closeTime: "18:00" }] };
  return {
    enabled: true,
    schedule: {
      0: closed,
      1: open,
      2: open,
      3: open,
      4: open,
      5: open,
      6: closed,
      ...overrides,
    },
    closurePeriods: [],
  };
}

function settings(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    reservationMode: "request",
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 0,
    turnoverBufferMinutes: 0,
    pendingBlocksAvailability: true,
    timezone: "UTC",
    ...overrides,
  };
}

function store(overrides: Partial<MarketplaceBookingStore> = {}): MarketplaceBookingStore {
  return {
    id: storeId,
    slug: "test-store",
    settings: settings(),
    channelStatus: "published",
    ...overrides,
  };
}

function availability(overrides: Partial<AvailabilityResponse> = {}): AvailabilityResponse {
  return {
    products: [
      {
        productId,
        totalQuantity: 3,
        reservedQuantity: 1,
        availableQuantity: 2,
        status: "limited",
      },
    ],
    period: {
      startDate: "2026-08-31T09:00:00.000Z",
      endDate: "2026-08-31T10:00:00.000Z",
    },
    businessHoursValidation: { valid: true, errors: [] },
    advanceNoticeValidation: { valid: true },
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MarketplaceAvailabilityDependencies> = {},
): MarketplaceAvailabilityDependencies {
  return {
    loadStore: async () => store(),
    getAvailability: async () => availability(),
    loadCalendarProduct: async () => ({
      id: productId,
      quantity: 3,
      trackUnits: false,
      bookingAttributeAxes: null,
    }),
    loadCalendarInventory: async () => {
      throw new Error("calendar inventory was not configured");
    },
    now: () => new Date("2026-08-31T07:00:00.000Z"),
    ...overrides,
  };
}

test("evaluates availability windows concurrently and keeps reasons scoped per window", async () => {
  const pending: Array<(value: AvailabilityResponse) => void> = [];
  let calls = 0;
  const resultPromise = availabilityMarketplaceBooking(
    {
      input: {
        storeId,
        items: [{ productId, quantity: 3 }],
        windows: [
          {
            startAt: "2026-08-31T09:00:00.000Z",
            endAt: "2026-08-31T09:30:00.000Z",
          },
          {
            startAt: "2026-09-01T09:00:00.000Z",
            endAt: "2026-09-01T13:00:00.000Z",
          },
        ],
      },
    },
    dependencies({
      loadStore: async () => store({ settings: settings({ maxRentalMinutes: 180 }) }),
      getAvailability: async () => {
        calls += 1;
        return new Promise((resolve) => pending.push(resolve));
      },
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  pending[0](
    availability({
      businessHoursValidation: { valid: false, errors: ["pickup_day_closed"] },
    }),
  );
  pending[1](
    availability({
      products: [
        {
          productId,
          totalQuantity: 5,
          reservedQuantity: 0,
          availableQuantity: 5,
          status: "available",
        },
      ],
      advanceNoticeValidation: { valid: false },
    }),
  );

  const result = await resultPromise;
  assert.deepEqual(result.windows[0].reasons, [
    { productId, code: "min_duration" },
    { productId, code: "closed" },
    { productId, code: "out_of_stock" },
  ]);
  assert.deepEqual(result.windows[1].reasons, [
    { productId, code: "max_duration" },
    { productId, code: "advance_notice" },
  ]);
  assert.equal(result.windows[0].available, false);
  assert.equal(result.windows[1].available, false);
});

test("uses matching tracked-unit combinations for window quantities", async () => {
  const result = await availabilityMarketplaceBooking(
    {
      input: {
        storeId,
        items: [{ productId, quantity: 2, attributes: { size: "M" } }],
        windows: [
          {
            startAt: "2026-08-31T09:00:00.000Z",
            endAt: "2026-08-31T11:00:00.000Z",
          },
        ],
      },
    },
    dependencies({
      getAvailability: async () =>
        availability({
          products: [
            {
              productId,
              totalQuantity: 5,
              reservedQuantity: 0,
              availableQuantity: 5,
              status: "available",
              combinations: [
                {
                  combinationKey: "size:M",
                  selectedAttributes: { size: "M" },
                  totalQuantity: 1,
                  reservedQuantity: 0,
                  availableQuantity: 1,
                  status: "available",
                },
                {
                  combinationKey: "size:L",
                  selectedAttributes: { size: "L" },
                  totalQuantity: 4,
                  reservedQuantity: 0,
                  availableQuantity: 4,
                  status: "available",
                },
              ],
            },
          ],
        }),
    }),
  );

  assert.deepEqual(result.windows[0].items, [{ productId, availableQuantity: 1 }]);
  assert.deepEqual(result.windows[0].reasons, [{ productId, code: "out_of_stock" }]);
});

test("returns every window unavailable when the marketplace channel is unpublished", async () => {
  let availabilityCalls = 0;
  const result = await availabilityMarketplaceBooking(
    {
      input: {
        storeId,
        items: [{ productId, quantity: 1 }],
        windows: [
          {
            startAt: "2026-08-31T09:00:00.000Z",
            endAt: "2026-08-31T11:00:00.000Z",
          },
        ],
      },
    },
    dependencies({
      loadStore: async () => store({ channelStatus: "paused" }),
      getAvailability: async () => {
        availabilityCalls += 1;
        return availability();
      },
    }),
  );

  assert.equal(availabilityCalls, 0);
  assert.deepEqual(result.windows[0], {
    startAt: "2026-08-31T09:00:00.000Z",
    endAt: "2026-08-31T11:00:00.000Z",
    available: false,
    reasons: [{ productId, code: "channel_unpublished" }],
    items: [{ productId, availableQuantity: 0 }],
  });
});

function withoutHours<T extends { hours: unknown }>(days: T[]): Array<Omit<T, "hours">> {
  return days.map(({ hours: _hours, ...day }) => day);
}

test("sweeps calendar reservations in memory with buffer, closures, notice, and combinations", async () => {
  let inventoryCalls = 0;
  const calendarSettings = settings({
    advanceNoticeMinutes: 120,
    turnoverBufferMinutes: 60,
    businessHours: {
      ...businessHours(),
      closurePeriods: [
        {
          id: "closure",
          name: "Closed",
          startDate: "2026-09-01",
          endDate: "2026-09-01",
        },
      ],
    },
  });
  const inventory: CalendarInventory = {
    product: {
      id: productId,
      quantity: 5,
      trackUnits: true,
      bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
    },
    units: [
      {
        id: "unit-m-1",
        combinationKey: "size:M",
        attributes: { size: "M" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-m-2",
        combinationKey: "size:M",
        attributes: { size: "M" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-m-3",
        combinationKey: "size:M",
        attributes: { size: "M" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-l-1",
        combinationKey: "size:L",
        attributes: { size: "L" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-l-2",
        combinationKey: "size:L",
        attributes: { size: "L" },
        lifecycleStatus: "active",
      },
    ],
    unitInfo: new Map(),
    reservations: [
      {
        status: "confirmed",
        startDate: new Date("2026-08-31T07:00:00.000Z"),
        endDate: new Date("2026-08-31T08:30:00.000Z"),
        items: [{ productId, combinationKey: "size:M", quantity: 2, assignedUnits: [] }],
      },
      {
        status: "confirmed",
        startDate: new Date("2026-09-02T10:00:00.000Z"),
        endDate: new Date("2026-09-02T13:00:00.000Z"),
        items: [{ productId, combinationKey: "size:M", quantity: 1, assignedUnits: [] }],
      },
      {
        status: "pending",
        startDate: new Date("2026-09-02T11:00:00.000Z"),
        endDate: new Date("2026-09-02T12:00:00.000Z"),
        items: [{ productId, combinationKey: "size:M", quantity: 1, assignedUnits: [] }],
      },
    ],
  };

  const result = await calendarMarketplaceBooking(
    {
      input: {
        storeId,
        productId,
        attributes: { size: "M" },
        from: "2026-08-31",
        to: "2026-09-02",
      },
    },
    dependencies({
      loadStore: async () => store({ settings: calendarSettings }),
      loadCalendarInventory: async ({ rangeStart, rangeEnd }) => {
        inventoryCalls += 1;
        assert.equal(rangeStart.toISOString(), "2026-08-31T00:00:00.000Z");
        assert.equal(rangeEnd.toISOString(), "2026-09-03T00:00:00.000Z");
        return inventory;
      },
      now: () => new Date("2026-08-31T17:00:00.000Z"),
    }),
  );

  assert.equal(inventoryCalls, 1);
  assert.deepEqual(result.rules, {
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 120,
    turnoverBufferMinutes: 60,
    defaultStartTime: "09:00",
    defaultEndTime: "18:00",
  });
  assert.deepEqual(withoutHours(result.days), [
    { date: "2026-08-31", open: true, withinNotice: true, availableQuantity: 1 },
    { date: "2026-09-01", open: false, withinNotice: false, availableQuantity: 0 },
    { date: "2026-09-02", open: true, withinNotice: false, availableQuantity: 1 },
  ]);
  assert.deepEqual(result.days[1]?.hours, []);
  assert.ok((result.days[0]?.hours?.length ?? 0) > 0);
  assert.match(result.days[0]?.hours?.[0]?.open ?? "", /^\d{2}:\d{2}$/u);
});

test("rejects calendar ranges longer than 93 days before loading data", async () => {
  let storeCalls = 0;

  await assert.rejects(
    calendarMarketplaceBooking(
      {
        input: {
          storeId,
          productId,
          from: "2026-01-01",
          to: "2026-04-06",
        },
      },
      dependencies({
        loadStore: async () => {
          storeCalls += 1;
          return store();
        },
      }),
    ),
    (error: unknown) => error instanceof ApiServiceError && error.code === "BAD_REQUEST",
  );
  assert.equal(storeCalls, 0);
});

test("returns zero calendar capacity for a known product on an unpublished channel", async () => {
  let inventoryCalls = 0;
  const result = await calendarMarketplaceBooking(
    {
      input: {
        storeId,
        productId,
        from: "2026-08-31",
        to: "2026-08-31",
      },
    },
    dependencies({
      loadStore: async () => store({ channelStatus: "paused" }),
      loadCalendarInventory: async () => {
        inventoryCalls += 1;
        throw new Error("unpublished calendars must not query reservations");
      },
    }),
  );

  assert.equal(inventoryCalls, 0);
  assert.deepEqual(withoutHours(result.days), [
    { date: "2026-08-31", open: true, withinNotice: false, availableQuantity: 0 },
  ]);
});

test("does not count reservations that only overlap a gap between opening ranges", async () => {
  const result = await calendarMarketplaceBooking(
    {
      input: {
        storeId,
        productId,
        from: "2026-08-31",
        to: "2026-08-31",
      },
    },
    dependencies({
      loadStore: async () =>
        store({
          settings: settings({
            businessHours: businessHours({
              1: {
                isOpen: true,
                ranges: [
                  { openTime: "09:00", closeTime: "12:00" },
                  { openTime: "14:00", closeTime: "18:00" },
                ],
              },
            }),
          }),
        }),
      loadCalendarInventory: async () => ({
        product: {
          id: productId,
          quantity: 3,
          trackUnits: false,
          bookingAttributeAxes: null,
        },
        units: [],
        unitInfo: new Map(),
        reservations: [
          {
            status: "confirmed",
            startDate: new Date("2026-08-31T12:30:00.000Z"),
            endDate: new Date("2026-08-31T13:30:00.000Z"),
            items: [{ productId, quantity: 3, assignedUnits: [] }],
          },
        ],
      }),
    }),
  );

  assert.equal(result.days[0].availableQuantity, 3);
});

test("propagates a not-found error for an unknown or inactive calendar product", async () => {
  await assert.rejects(
    calendarMarketplaceBooking(
      {
        input: {
          storeId,
          productId,
          from: "2026-08-31",
          to: "2026-08-31",
        },
      },
      dependencies({
        loadStore: async () => store({ channelStatus: "paused" }),
        loadCalendarProduct: async () => {
          throw new ApiServiceError("NOT_FOUND", "errors.productNotFound");
        },
      }),
    ),
    (error: unknown) => error instanceof ApiServiceError && error.code === "NOT_FOUND",
  );
});

test("treats an empty attribute selection as every combination, not the first one", async () => {
  const inventory: CalendarInventory = {
    product: {
      id: productId,
      quantity: 5,
      trackUnits: true,
      bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
    },
    units: [
      {
        id: "unit-m-1",
        combinationKey: "size:M",
        attributes: { size: "M" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-m-2",
        combinationKey: "size:M",
        attributes: { size: "M" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-m-3",
        combinationKey: "size:M",
        attributes: { size: "M" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-l-1",
        combinationKey: "size:L",
        attributes: { size: "L" },
        lifecycleStatus: "active",
      },
      {
        id: "unit-l-2",
        combinationKey: "size:L",
        attributes: { size: "L" },
        lifecycleStatus: "active",
      },
    ],
    unitInfo: new Map(),
    reservations: [],
  };
  const deps = dependencies({
    loadStore: async () => store({ settings: settings() }),
    loadCalendarInventory: async () => inventory,
    now: () => new Date("2026-08-01T08:00:00.000Z"),
  });

  const any = await calendarMarketplaceBooking(
    { input: { storeId, productId, attributes: {}, from: "2026-09-02", to: "2026-09-02" } },
    deps,
  );
  const large = await calendarMarketplaceBooking(
    {
      input: {
        storeId,
        productId,
        attributes: { size: "L" },
        from: "2026-09-02",
        to: "2026-09-02",
      },
    },
    deps,
  );

  assert.equal(any.days[0]?.availableQuantity, 5);
  assert.equal(large.days[0]?.availableQuantity, 2);
});
