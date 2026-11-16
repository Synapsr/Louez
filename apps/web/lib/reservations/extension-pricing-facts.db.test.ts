import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { NOT_RECORDED, recordedPromotion } from "@louez/api/services/pricing-facts";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// An extension prices its lines again over the longer window: a line that
// recorded its promotion keeps it recorded (slice 9), the one its extended
// price applied, or none; a line that recorded nothing still records nothing.
// No amount changes.

// The checkout modules import Next.js-only guards and the file storage SDK.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only" || specifier === "@/lib/storage/files"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

const STORE = "store_extension_facts";
const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");
const EXTENDED = new Date("2030-06-04T09:00:00Z");

// The extension's plan for this booking before 0107: no amount changes. Per
// line, in the lines' order: unit price, total, tax rate, tax, price before
// tax, total before tax.
const PLAN_MONEY = {
  subtotalAmount: "82.50",
  totalAmount: "82.50",
  subtotalExclTax: null,
  taxAmount: null,
  taxRate: null,
};
const PLAN_LINES = [
  ["22.50", "22.50", null, null, null, null],
  ["30.00", "30.00", null, null, null, null],
  ["30.00", "30.00", null, null, null, null],
];

describe("an extension's pricing facts (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let extension: typeof import("./extension-quote");
  let types: typeof import("./extension.types");

  before(async () => {
    database = await createTestDatabase("extension_pricing_facts");
    louezDb = await import("@louez/db");
    extension = await import("./extension-quote");
    types = await import("./extension.types");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Extension facts",
      slug: "extension-facts",
      // A supplement is charged online: the store takes payments.
      stripeAccountId: "acct_extension_facts",
      stripeChargesEnabled: true,
      settings: {
        reservationMode: "request",
        currency: "EUR",
        advanceNoticeMinutes: 0,
        pendingBlocksAvailability: true,
      },
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("a recorded promotion stays recorded, a recorded none stays none; no amount changes", async () => {
    // 10.00 a day; one of them 25 % off.
    const product = async (id: string, promotion: boolean) =>
      louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: id,
        price: "10.00",
        pricingMode: "day",
        quantity: 5,
        promotion: promotion ? { percentage: 25, startsOn: null, endsOn: null } : null,
      });
    await product("ext_prd_promoted", true);
    await product("ext_prd_plain", false);
    await product("ext_prd_old", false);
    await louezDb.db.insert(louezDb.reservations).values({
      id: "ext_res",
      storeId: STORE,
      customerId: "customer",
      number: "ext_res",
      status: "confirmed",
      startDate: START,
      endDate: END,
      subtotalAmount: "55.00",
      depositAmount: "0.00",
      totalAmount: "55.00",
      currency: "EUR",
      taxDisplayMode: "inclusive",
      source: "online",
    });
    const breakdown = (
      promotion: { percentage: number; originalSubtotal: number; discountAmount: number } | null,
    ) => ({
      basePrice: 10,
      effectivePrice: promotion ? 15 : 20,
      duration: 2,
      pricingMode: "day" as const,
      discountPercent: promotion?.percentage ?? null,
      discountAmount: promotion?.discountAmount ?? 0,
      tierApplied: null,
      promotion,
      taxRate: null,
      taxAmount: null,
      subtotalExclTax: null,
      subtotalInclTax: promotion ? 15 : 20,
    });
    const line = (id: string, productId: string, total: string, pricingBreakdown: unknown) =>
      louezDb.db.insert(louezDb.reservationItems).values({
        id,
        reservationId: "ext_res",
        productId,
        quantity: 1,
        unitPrice: total,
        depositPerUnit: "0.00",
        totalPrice: total,
        taxExempt: false,
        productSnapshot: { name: productId, description: null, images: [] },
        ...(pricingBreakdown
          ? { pricingBreakdown: pricingBreakdown as ReturnType<typeof breakdown> }
          : {}),
      });
    await line(
      "ext_itm_1",
      "ext_prd_promoted",
      "15.00",
      breakdown({ percentage: 25, originalSubtotal: 20, discountAmount: 5 }),
    );
    await line("ext_itm_2", "ext_prd_plain", "20.00", breakdown(null));
    // A line booked before its promotion was recorded.
    await line("ext_itm_3", "ext_prd_old", "20.00", null);
    // Paid in full: the supplement alone is charged.
    await louezDb.db.insert(louezDb.payments).values({
      id: "ext_pay",
      reservationId: "ext_res",
      amount: "55.00",
      type: "rental",
      method: "cash",
      status: "completed",
      currency: "EUR",
    });

    const quoted = await extension.runExtensionQuote(
      { storeId: STORE, reservationId: "ext_res" },
      (tx, reservation) => extension.quoteExtension(tx, reservation, EXTENDED),
    );
    const { plan } = quoted;
    assert.ok(plan, JSON.stringify(quoted.preview));
    // As the attempt stores it and reads it back.
    const stored = types.extensionAttemptSchema.shape.plan.parse(plan);

    const { items, ...money } = stored;
    assert.deepEqual(money, PLAN_MONEY);
    assert.deepEqual(
      items.map((item) => [
        item.unitPrice,
        item.totalPrice,
        item.taxRate,
        item.taxAmount,
        item.priceExclTax,
        item.totalExclTax,
      ]),
      PLAN_LINES,
    );
    const promotions = items.map((item) =>
      recordedPromotion({ pricingBreakdown: item.pricingBreakdown ?? null }),
    );
    assert.deepEqual(promotions, [
      { percentage: 25, originalSubtotal: 30, discountAmount: 7.5 },
      null,
      NOT_RECORDED,
    ]);
  });
});
