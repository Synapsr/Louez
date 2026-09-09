/* oxlint-disable unicorn/no-thenable -- Drizzle query builders are awaitable. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as nodeModule from "node:module";
import { getTableName } from "drizzle-orm";
import { createRequire } from "node:module";
import type { Transaction } from "@louez/db";
import type { ExtensionReservation } from "./extension-quote";

const registerHooks = Reflect.get(nodeModule, "registerHooks");
registerHooks({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});
const load = () => import("./extension-quote");
const base = () =>
  ({
    id: "reservation",
    storeId: "store",
    status: "confirmed",
    source: "online",
    startDate: new Date("2030-06-10T10:00:00Z"),
    endDate: new Date("2030-06-11T10:00:00Z"),
    totalAmount: "20.00",
    subtotalAmount: "20.00",
    depositAmount: "0",
    deliveryFee: "0",
    discountAmount: "0",
    returnMethod: "store",
    store: {
      id: "store",
      stripeAccountId: "acct_test",
      stripeChargesEnabled: true,
      settings: { timezone: "Europe/Paris", currency: "EUR" },
    },
    items: [
      {
        id: "item",
        productId: "product",
        isCustomItem: false,
        quantity: 1,
        unitPrice: "20.00",
        totalPrice: "20.00",
        assignedUnits: [],
      },
    ],
    payments: [{ id: "payment", type: "rental", status: "completed", amount: "20.00" }],
    activity: [],
  }) as unknown as ExtensionReservation;
const end = new Date("2030-06-12T10:00:00Z");

const fixtureTx = (quantity = 2, price = "20.00", overrides: Record<string, unknown> = {}) => {
  const product = {
    id: "product",
    storeId: "store",
    name: "Bike",
    status: "active",
    price,
    deposit: "0",
    stockKind: "returnable",
    quantity,
    trackUnits: false,
    pricingKind: "duration",
    pricingMode: "day",
    pricingTiers: [],
    ...overrides,
  };
  const tx = {
    execute: async () => [],
    query: {
      products: { findMany: async () => [product] },
      reservations: { findMany: async () => [] },
    },
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const rows = getTableName(table) === "products" ? [product] : [];
        const result = {
          where: () => result,
          orderBy: () => result,
          for: () => result,
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
        };
        return result;
      },
    }),
  } as unknown as Transaction;
  return tx;
};

test("only later return dates are accepted; nonexistent DST wall times are rejected", async () => {
  const { quoteExtension, parseExtensionEnd } = await load();
  await assert.rejects(quoteExtension(fixtureTx(), base(), base().endDate), /invalidDate/);
  await assert.rejects(quoteExtension(fixtureTx(), base(), new Date("2030-06-09")), /invalidDate/);
  assert.throws(() => parseExtensionEnd("2030-03-31T02:30", "Europe/Paris"), /invalidDate/);
});

test("insurance, late returns, negotiated prices, delivery and deposit expiry require merchant review", async () => {
  const { extensionManualReason } = await load();
  const cases: Array<[Partial<ExtensionReservation>, string]> = [
    [{ tulipInsuranceOptIn: true }, "insurance"],
    [{ tulipContractId: "insurance" }, "insurance"],
    [{ discountAmount: "5" }, "manualPrice"],
    [{ source: "marketplace" }, "manualPrice"],
    [{ returnMethod: "address" }, "delivery"],
    [{ returnLocationId: "depot" }, "location"],
    [{ endDate: new Date("2000-01-01") }, "overdue"],
    [
      { depositAmount: "200", depositStatus: "authorized", depositAuthorizationExpiresAt: end },
      "deposit",
    ],
    [{ payments: [] }, "unpaid"],
  ];
  for (const [changes, expected] of cases)
    assert.equal(extensionManualReason({ ...base(), ...changes }, end), expected);
  const disabled = base();
  disabled.store.settings = {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    automaticExtensions: false,
  };
  assert.equal(extensionManualReason(disabled, end), "disabled");
  assert.equal(extensionManualReason(base(), end), null);
});

test("closed statuses, extension duration caps and closed return times are rejected", async () => {
  const { quoteExtension } = await load();
  for (const status of ["cancelled", "completed", "rejected", "pending", "quote"] as const)
    await assert.rejects(quoteExtension(fixtureTx(), { ...base(), status }, end), /invalidStatus/);
  const capped = base();
  capped.store.settings = {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    maxExtensionDays: 1,
  };
  await assert.rejects(quoteExtension(fixtureTx(), capped, new Date("2030-06-14")), /tooLong/);
});

test("prices the extra period and refuses stock conflicts or a changed original price", async () => {
  const { quoteExtension } = await load();
  const quote = await quoteExtension(fixtureTx(), base(), end);
  assert.equal(quote.preview.mode, "automatic");
  if (quote.preview.mode === "automatic") {
    assert.equal(quote.preview.supplement, 20);
    assert.equal(quote.preview.total, 40);
  }
  await assert.rejects(quoteExtension(fixtureTx(0), base(), end), /unavailable/);
  const repriced = await quoteExtension(fixtureTx(2, "30.00"), base(), end);
  assert.deepEqual(repriced.preview, { mode: "manual", reason: "manualPrice" });
});

test("fingerprint changes when dates, quantities, assigned units or agreed prices change", async () => {
  const { extensionFingerprint } = await load();
  const original = base();
  for (const updated of [
    { ...original, endDate: end },
    { ...original, totalAmount: "30" },
    { ...original, status: "cancelled" as const },
    { ...original, items: original.items.map((item) => ({ ...item, quantity: 2 })) },
  ])
    assert.notEqual(extensionFingerprint(original), extensionFingerprint(updated));
});

test("temporary extension holds participate in shared stock calculations", async () => {
  const { computeReservedNetOfExcludedUnits } = createRequire(import.meta.url)(
    "@louez/api/services",
  ) as typeof import("@louez/api/services");
  const params = {
    startDate: new Date("2030-06-12"),
    endDate: new Date("2030-06-13"),
    turnoverBufferMinutes: 30,
    excludedProductUnitIds: new Set<string>(),
    excludedUnitInfo: new Map(),
    reservations: [
      {
        status: "confirmed",
        startDate: new Date("2030-06-09"),
        endDate: new Date("2030-06-10"),
        activity: [
          {
            metadata: {
              kind: "rental_extension",
              status: "checkout",
              requestedEndMs: new Date("2030-06-14").getTime(),
              expiresMs: Date.now() + 60000,
            },
          },
        ],
        items: [{ productId: "product", quantity: 1, assignedUnits: [] }],
      },
    ],
  };
  assert.equal(computeReservedNetOfExcludedUnits(params).reservedByProduct.get("product"), 1);
  params.reservations[0].activity[0].metadata.expiresMs = 0;
  assert.equal(computeReservedNetOfExcludedUnits(params).reservedByProduct.get("product") ?? 0, 0);
});

test("all lines share stock, including multiple lines of the same product", async () => {
  const { quoteExtension } = await load();
  const reservation = base();
  reservation.items.push({ ...reservation.items[0], id: "second-item" });
  reservation.totalAmount = "40.00";
  reservation.subtotalAmount = "40.00";
  reservation.payments[0].amount = "40.00";
  await assert.rejects(quoteExtension(fixtureTx(1), reservation, end), /unavailable/);
});

test("consumables already supplied are not charged or consumed a second time", async () => {
  const { quoteExtension } = await load();
  const result = await quoteExtension(
    fixtureTx(0, "20.00", { stockKind: "consumable", pricingKind: "fixed" }),
    base(),
    end,
  );
  assert.equal(result.preview.mode, "automatic");
  if (result.preview.mode === "automatic") assert.equal(result.preview.supplement, 0);
});

test("a downtime on the assigned unit prevents extension even when another unit is free", async () => {
  const { quoteExtension } = await load();
  const { MySqlDialect } = await import("drizzle-orm/mysql-core");
  const product = {
    id: "product",
    storeId: "store",
    name: "Bike",
    status: "active",
    price: "20.00",
    deposit: "0",
    stockKind: "returnable",
    quantity: 2,
    trackUnits: true,
    pricingKind: "duration",
    pricingMode: "day",
  };
  const units = [
    { id: "unitA", productId: "product", combinationKey: "default", attributes: {} },
    { id: "unitB", productId: "product", combinationKey: "default", attributes: {} },
  ];
  const trackedTx = {
    execute: async () => [],
    query: {
      products: { findMany: async () => [product] },
      reservations: { findMany: async () => [] },
    },
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        let rows: unknown[] =
          name === "products" ? [product] : name === "product_units" ? units : [];
        const result = {
          where: (condition: Parameters<InstanceType<typeof MySqlDialect>["sqlToQuery"]>[0]) => {
            const query = new MySqlDialect().sqlToQuery(condition);
            if (name === "product_units")
              rows = units.filter(
                (unit) =>
                  (!query.params.includes("unitA") || unit.id === "unitA") &&
                  (!query.params.includes("active") || unit.id !== "unitA"),
              );
            return result;
          },
          leftJoin: () => result,
          innerJoin: () => result,
          orderBy: () => result,
          for: () => result,
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
        };
        return result;
      },
    }),
  } as unknown as Transaction;
  const reservation = base();
  reservation.items[0].assignedUnits = [
    { productUnitId: "unitA" },
  ] as ExtensionReservation["items"][number]["assignedUnits"];
  await assert.rejects(quoteExtension(trackedTx, reservation, end), /unavailable/);
});

test("return hours and the cumulative extension limit are enforced", async () => {
  const { quoteExtension } = await load();
  const reservation = base();
  const closed = { isOpen: false, ranges: [] };
  reservation.store.settings = {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    businessHours: {
      enabled: true,
      closurePeriods: [],
      schedule: { 0: closed, 1: closed, 2: closed, 3: closed, 4: closed, 5: closed, 6: closed },
    },
  };
  await assert.rejects(quoteExtension(fixtureTx(), reservation, end), /closed/);
  reservation.store.settings = {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    maxExtensionDays: 2,
  };
  reservation.activity = [
    {
      id: "prior",
      reservationId: reservation.id,
      activityType: "modified",
      createdAt: new Date(),
      userId: null,
      description: null,
      metadata: {
        kind: "rental_extension",
        status: "confirmed",
        requestedEndMs: reservation.endDate.getTime(),
        expiresMs: 0,
        fingerprint: "prior",
        originalEndDate: "2030-06-09T10:00:00.000Z",
        supplement: 0,
        currency: "EUR",
        plan: {
          subtotalAmount: "20",
          totalAmount: "20",
          subtotalExclTax: null,
          taxAmount: null,
          taxRate: null,
          items: [],
        },
      },
    },
  ];
  await assert.rejects(quoteExtension(fixtureTx(), reservation, end), /tooLong/);
});
