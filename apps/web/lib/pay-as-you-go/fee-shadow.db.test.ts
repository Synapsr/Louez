import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { log } from "@/lib/evlog";

// The fee at source in shadow (louez-billing docs/api, fees.md §5 and §8; m2-plan L2):
// planApplicationFee charges what the legacy planner returns and logs fees.md §8 on the
// cached policy, a louez_legacy one read as if the service invoiced the store. The
// policies use the public test values of fees.md (Q33): 123 and 250 bps, a 150
// marketplace fee and a 90 per-reservation fee. The legacy flat rates are test values
// too.

const NEW_STORES_FROM = "2026-06-01T00:00:00Z";
const OLD_STORE = "shadow_old_store";
const PLAIN_STORE = "shadow_plain_old";
const NEW_STORE = "shadow_new_store";
const PERCENT_STORE = "shadow_pct_store";

const base = {
  schema: "louez.billing.policy/1",
  issuedAt: "2026-01-01T00:00:00Z",
  newStoresCreatedFrom: null,
  effectiveFrom: "2026-01-01T00:00:00Z",
  currency: "EUR",
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
};
const OLD_STORE_V1 = {
  ...base,
  storeId: OLD_STORE,
  version: 1,
  offerKey: "test-legacy",
  invoicing: "louez_legacy",
  applicationFee: { kind: "per_reservation", amountMinor: 90 },
};
const OLD_STORE_V2_PERCENT = {
  ...base,
  storeId: OLD_STORE,
  version: 2,
  // Not in force yet: only a past payment names it.
  effectiveFrom: "2037-01-01T00:00:00Z",
  offerKey: "test-commission",
  invoicing: "service",
  applicationFee: {
    kind: "percent",
    rateBps: 123,
    minMinor: 0,
    maxMinor: null,
    excludeInsurance: true,
    appliesTo: ["rental", "extension"],
  },
};

const DEFAULT_V1 = {
  ...base,
  storeId: "*",
  version: 1,
  // Not in force yet: only a past payment names it.
  effectiveFrom: "2037-01-01T00:00:00Z",
  newStoresCreatedFrom: "2037-01-01T00:00:00Z",
  offerKey: "test-commission",
  invoicing: "service",
  applicationFee: OLD_STORE_V2_PERCENT.applicationFee,
};
const PERCENT_STORE_V1 = {
  ...base,
  storeId: PERCENT_STORE,
  version: 1,
  offerKey: "test-commission",
  invoicing: "service",
  applicationFee: { ...OLD_STORE_V2_PERCENT.applicationFee, rateBps: 250 },
};

const NO_FACTS = {
  isMarketplace: false,
  marketplaceWaived: false,
  marketplaceAlreadyTaken: false,
  reservationAlreadyBillable: false,
  reservationFeeAlreadyTaken: false,
};
const NO_FEE = { totalMinor: 0, reservationMinor: 0, marketplaceMinor: 0, baseMinor: 0 };

const lineSchema = z.object({ billing: z.record(z.string(), z.unknown()) });
const spyLog = () => ({
  info: mock.method(log, "info", () => {}),
  warn: mock.method(log, "warn", () => {}),
});

describe("the fee at source in shadow (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let metering: typeof import("./metering");
  const names = ["LOUEZ_BILLING", "BILLING_SERVICE_URL", "BILLING_NEW_STORES_FROM"] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  let spies: ReturnType<typeof spyLog>;

  before(async () => {
    database = await createTestDatabase("fee_shadow");
    louezDb = await import("@louez/db");
    metering = await import("./metering");
    const store = (id: string, createdAt: string) => ({
      id,
      userId: `user_${id}`,
      name: id,
      slug: id.replaceAll("_", "-"),
      createdAt: new Date(createdAt),
    });
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        store(OLD_STORE, "2026-01-01T00:00:00Z"),
        store(PLAIN_STORE, "2026-01-01T00:00:00Z"),
        store(NEW_STORE, "2026-07-01T00:00:00Z"),
        store(PERCENT_STORE, "2026-01-01T00:00:00Z"),
      ]);
    const payAsYouGo = {
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1",
      freeReservationsGranted: 0,
    } as const;
    await louezDb.db.insert(louezDb.subscriptions).values([
      { id: "sub_shadow_old", storeId: OLD_STORE, ...payAsYouGo },
      { id: "sub_shadow_plain", storeId: PLAIN_STORE, ...payAsYouGo },
      { id: "sub_shadow_new", storeId: NEW_STORE, ...payAsYouGo },
      // 150 + 90: what the shadow takes on res_shadow_pct_market's 3600.
      {
        id: "sub_shadow_pct",
        storeId: PERCENT_STORE,
        ...payAsYouGo,
        payAsYouGoConfig: { flatRateCents: 240 },
      },
    ]);
    const reservation = (
      id: string,
      storeId: string,
      extra: { source?: string; billableAt?: Date } = {},
    ) => ({
      id,
      storeId,
      customerId: "customer_shadow",
      number: id,
      status: "pending" as const,
      startDate: new Date("2026-11-20T09:00:00Z"),
      endDate: new Date("2026-11-22T09:00:00Z"),
      subtotalAmount: "200.00",
      depositAmount: "0.00",
      totalAmount: "200.00",
      ...extra,
    });
    await louezDb.db.insert(louezDb.reservations).values([
      reservation("res_shadow_fresh", OLD_STORE),
      reservation("res_shadow_billable", OLD_STORE, {
        billableAt: new Date("2026-10-01T10:00:00Z"),
      }),
      reservation("res_shadow_market", OLD_STORE, { source: "marketplace" }),
      reservation("res_shadow_paid", OLD_STORE),
      reservation("res_shadow_ext", OLD_STORE),
      reservation("res_shadow_unknown", OLD_STORE),
      reservation("res_shadow_legacy", OLD_STORE),
      reservation("res_shadow_default", OLD_STORE),
      reservation("res_shadow_mkt_only", OLD_STORE),
      reservation("res_shadow_no_version", OLD_STORE),
      reservation("res_shadow_plain", PLAIN_STORE),
      reservation("res_shadow_new", NEW_STORE),
      reservation("res_shadow_pct", PERCENT_STORE),
      reservation("res_shadow_pct_market", PERCENT_STORE, { source: "marketplace" }),
    ]);
    const payment = (
      id: string,
      reservationId: string,
      appFee: {
        reservationMinor: number;
        marketplaceMinor: number;
        scope: "store" | "default" | "legacy";
        version: number | null;
      },
      extra: { origin?: "customer_session" | "extension"; status?: "completed" | "pending" } = {},
    ) => ({
      id,
      reservationId,
      amount: "50.00",
      type: "rental" as const,
      method: "stripe" as const,
      status: extra.status ?? ("completed" as const),
      origin: extra.origin ?? ("customer_session" as const),
      appFeeTotalMinor: appFee.reservationMinor + appFee.marketplaceMinor,
      appFeeReservationMinor: appFee.reservationMinor,
      appFeeMarketplaceMinor: appFee.marketplaceMinor,
      appFeeBaseMinor: 0,
      appFeePolicyScope: appFee.scope,
      appFeePolicyVersion: appFee.version,
      appFeeMetadataVersion: 4,
    });
    await louezDb.db.insert(louezDb.payments).values([
      // A per_reservation fee taken at source under the store's v1.
      payment("pay_shadow_paid", "res_shadow_paid", {
        reservationMinor: 90,
        marketplaceMinor: 150,
        scope: "store",
        version: 1,
      }),
      // An extension never counts (Q22), nor a percent fee, nor an unpaid session.
      payment(
        "pay_shadow_ext",
        "res_shadow_ext",
        { reservationMinor: 90, marketplaceMinor: 0, scope: "store", version: 1 },
        { origin: "extension" },
      ),
      payment("pay_shadow_pct", "res_shadow_ext", {
        reservationMinor: 25,
        marketplaceMinor: 0,
        scope: "store",
        version: 2,
      }),
      payment(
        "pay_shadow_open",
        "res_shadow_ext",
        { reservationMinor: 90, marketplaceMinor: 150, scope: "store", version: 1 },
        { status: "pending" },
      ),
      // A version Louez does not hold counts as a per_reservation fee.
      payment("pay_shadow_unknown", "res_shadow_unknown", {
        reservationMinor: 90,
        marketplaceMinor: 0,
        scope: "store",
        version: 7,
      }),
      // A legacy fee counts through its res: row, not through the payment.
      payment("pay_shadow_legacy", "res_shadow_legacy", {
        reservationMinor: 123,
        marketplaceMinor: 0,
        scope: "legacy",
        version: 0,
      }),
      // `default` names the `*` version, a percent one, not the store's own v1.
      payment("pay_shadow_default", "res_shadow_default", {
        reservationMinor: 25,
        marketplaceMinor: 0,
        scope: "default",
        version: 1,
      }),
      // The marketplace fee alone, under the store's per_reservation v1.
      payment("pay_shadow_mkt_only", "res_shadow_mkt_only", {
        reservationMinor: 0,
        marketplaceMinor: 150,
        scope: "store",
        version: 1,
      }),
      // A reservation part with no version counts, as an unknown version does.
      payment("pay_shadow_no_version", "res_shadow_no_version", {
        reservationMinor: 90,
        marketplaceMinor: 0,
        scope: "store",
        version: null,
      }),
    ]);
    await louezDb.db.insert(louezDb.billingPolicies).values(
      [OLD_STORE_V1, OLD_STORE_V2_PERCENT, DEFAULT_V1, PERCENT_STORE_V1].map((body) => ({
        storeId: body.storeId,
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      })),
    );
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM;
    spies = spyLog();
  });
  afterEach(() => {
    mock.restoreAll();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const rental = (storeId: string, reservationId: string) => ({
    storeId,
    reservationId,
    kind: "rental" as const,
    chargeMinor: 20_000,
    currency: "eur",
    insuranceShareMinor: 0,
  });
  const shadowLines = () =>
    spies.info.mock.calls.map((call) => lineSchema.parse(call.arguments[0]).billing);

  test("a legacy store is charged the legacy fee, and the policy's fee is logged beside it", async () => {
    const input = rental(OLD_STORE, "res_shadow_fresh");
    const expected = await metering.planStripeFees({
      storeId: OLD_STORE,
      reservationId: "res_shadow_fresh",
      chargeCents: 20_000,
    });
    assert.deepEqual(expected, {
      applicationFeeCents: 123,
      reservationFeeCents: 123,
      marketplaceFeeCents: 0,
    });

    assert.deepEqual(await metering.planApplicationFee(input), expected);
    assert.deepEqual(shadowLines(), [
      {
        event: "fee_shadow",
        storeId: OLD_STORE,
        reservationId: "res_shadow_fresh",
        kind: "rental",
        chargeMinor: 20_000,
        currency: "eur",
        insuranceShareMinor: 0,
        policy: { source: "store", version: 1, invoicing: "louez_legacy" },
        facts: NO_FACTS,
        charged: { totalMinor: 123, reservationMinor: 123, marketplaceMinor: 0 },
        shadow: { totalMinor: 90, reservationMinor: 90, marketplaceMinor: 0, baseMinor: 0 },
        outcome: "differs",
        differenceMinor: -33,
      },
    ]);
    assert.equal(spies.warn.mock.callCount(), 0);
  });

  test("a reservation already billable takes no per_reservation fee at source", async () => {
    await metering.planApplicationFee(rental(OLD_STORE, "res_shadow_billable"));
    const [line] = shadowLines();
    assert.deepEqual(line.facts, { ...NO_FACTS, reservationAlreadyBillable: true });
    assert.deepEqual(line.shadow, NO_FEE);
  });

  test("the facts of fees.md §8 come from the payments, the legacy rows and the waiver", async () => {
    const facts = (reservationId: string) =>
      metering.readFeeAtSourceFacts(OLD_STORE, reservationId);
    const none = NO_FACTS;
    assert.deepEqual(await facts("res_shadow_market"), { ...none, isMarketplace: true });
    assert.deepEqual(await facts("res_shadow_paid"), {
      ...none,
      marketplaceAlreadyTaken: true,
      reservationFeeAlreadyTaken: true,
    });
    assert.deepEqual(await facts("res_shadow_ext"), none);
    assert.deepEqual(await facts("res_shadow_unknown"), {
      ...none,
      reservationFeeAlreadyTaken: true,
    });

    // The legacy payment alone does not count; its res: row does, until it is voided.
    assert.deepEqual(await facts("res_shadow_legacy"), none);
    const legacyRow = (dedupKey: string, source: "online" | "marketplace_online") => ({
      id: dedupKey.replace(":", "_").slice(0, 21),
      storeId: OLD_STORE,
      reservationId: "res_shadow_legacy",
      dedupKey,
      amountCents: 123,
      source,
      status: "collected" as const,
      billingMonth: "2026-10",
    });
    await louezDb.db
      .insert(louezDb.platformFees)
      .values([
        legacyRow("res:res_shadow_legacy", "online"),
        legacyRow("mkt:res_shadow_legacy", "marketplace_online"),
      ]);
    assert.deepEqual(await facts("res_shadow_legacy"), {
      ...none,
      marketplaceAlreadyTaken: true,
      reservationFeeAlreadyTaken: true,
    });
    await louezDb.db.update(louezDb.platformFees).set({ status: "voided" });
    assert.deepEqual(await facts("res_shadow_legacy"), none);

    await louezDb.db.insert(louezDb.storeMarketplaceChannels).values({
      id: "chan_shadow_old",
      storeId: OLD_STORE,
      lifetimeFeeWaiverAt: new Date("2026-02-01T00:00:00Z"),
    });
    try {
      assert.deepEqual(await facts("res_shadow_market"), {
        ...none,
        isMarketplace: true,
        marketplaceWaived: true,
      });
    } finally {
      await louezDb.db.delete(louezDb.storeMarketplaceChannels);
    }

    await assert.rejects(
      metering.readFeeAtSourceFacts(PLAIN_STORE, "res_shadow_fresh"),
      /is not in store/,
    );
  });

  test("a past reservation part counts when the policy it names charged per reservation", async () => {
    const facts = (reservationId: string) =>
      metering.readFeeAtSourceFacts(OLD_STORE, reservationId);
    assert.deepEqual(await facts("res_shadow_default"), NO_FACTS);
    assert.deepEqual(await facts("res_shadow_mkt_only"), {
      ...NO_FACTS,
      marketplaceAlreadyTaken: true,
    });
    assert.deepEqual(await facts("res_shadow_no_version"), {
      ...NO_FACTS,
      reservationFeeAlreadyTaken: true,
    });
  });

  test("a marketplace customer session: the shadow reserves the marketplace fee first", async () => {
    const plan = await metering.planApplicationFee({
      ...rental(OLD_STORE, "res_shadow_market"),
      includeMarketplaceFee: true,
    });
    const [line] = shadowLines();
    assert.deepEqual(line.charged, {
      totalMinor: plan.applicationFeeCents,
      reservationMinor: plan.reservationFeeCents,
      marketplaceMinor: plan.marketplaceFeeCents,
    });
    assert.deepEqual(line.shadow, {
      totalMinor: 240,
      reservationMinor: 90,
      marketplaceMinor: 150,
      baseMinor: 0,
    });
  });

  test("a percent policy leaves the insurance share out of its base", async () => {
    await metering.planApplicationFee({
      ...rental(PERCENT_STORE, "res_shadow_pct"),
      insuranceShareMinor: 5_000,
    });
    const [line] = shadowLines();
    assert.deepEqual(line.policy, { source: "store", version: 1, invoicing: "service" });
    assert.equal(line.insuranceShareMinor, 5_000);
    assert.deepEqual(line.shadow, {
      totalMinor: 375,
      reservationMinor: 375,
      marketplaceMinor: 0,
      baseMinor: 15_000,
    });
  });

  test("in another currency than the policy's, the shadow skips the flat amounts", async () => {
    await metering.planApplicationFee({
      ...rental(PERCENT_STORE, "res_shadow_pct_market"),
      currency: "usd",
    });
    const [line] = shadowLines();
    assert.equal(line.currency, "usd");
    assert.deepEqual(line.shadow, {
      totalMinor: 500,
      reservationMinor: 500,
      marketplaceMinor: 0,
      baseMinor: 20_000,
    });
  });

  test("the same total split otherwise is a difference", async () => {
    const plan = await metering.planApplicationFee({
      ...rental(PERCENT_STORE, "res_shadow_pct_market"),
      chargeMinor: 3_600,
    });
    assert.deepEqual(plan, {
      applicationFeeCents: 240,
      reservationFeeCents: 240,
      marketplaceFeeCents: 0,
    });
    const [line] = shadowLines();
    assert.deepEqual(line.shadow, {
      totalMinor: 240,
      reservationMinor: 90,
      marketplaceMinor: 150,
      baseMinor: 3_600,
    });
    assert.equal(line.outcome, "differs");
    assert.equal(line.differenceMinor, 0);
  });

  test("a store with no policy logs that there is none", async () => {
    await metering.planApplicationFee(rental(PLAIN_STORE, "res_shadow_plain"));
    const [line] = shadowLines();
    assert.deepEqual(line.policy, { source: "legacy", version: null, invoicing: "louez_legacy" });
    assert.equal(line.facts, null);
    assert.equal(line.shadow, null);
    assert.equal(line.outcome, "no_policy");
    assert.equal(line.differenceMinor, null);
  });

  test("a new store with no version in force fails closed: no fee at source", async () => {
    const plan = await metering.planApplicationFee(rental(NEW_STORE, "res_shadow_new"));
    const [line] = shadowLines();
    assert.deepEqual(line.policy, { source: "fail_closed", version: null, invoicing: "service" });
    assert.deepEqual(line.shadow, NO_FEE);
    // The legacy planner still decides what is charged (L3 adds its guard).
    assert.equal(plan.applicationFeeCents, 123);
  });

  test("a custom payment request is charged nothing, as before, and still shadowed", async () => {
    const plan = await metering.planApplicationFee({
      ...rental(OLD_STORE, "res_shadow_fresh"),
      kind: "custom_request",
    });
    assert.deepEqual(plan, {
      applicationFeeCents: 0,
      reservationFeeCents: 0,
      marketplaceFeeCents: 0,
    });
    const [line] = shadowLines();
    assert.equal(line.kind, "custom_request");
    assert.equal(line.outcome, "same");
  });

  test("a failing shadow is logged and changes nothing", async () => {
    const plan = await metering.planApplicationFee(rental(OLD_STORE, "res_shadow_missing"));
    assert.deepEqual(plan, {
      applicationFeeCents: 123,
      reservationFeeCents: 123,
      marketplaceFeeCents: 0,
    });
    assert.equal(spies.info.mock.callCount(), 0);
    assert.equal(spies.warn.mock.callCount(), 1);
    assert.deepEqual(lineSchema.parse(spies.warn.mock.calls[0]?.arguments[0]).billing, {
      event: "fee_shadow_failed",
      storeId: OLD_STORE,
      reservationId: "res_shadow_missing",
      error: `reservation res_shadow_missing is not in store ${OLD_STORE}`,
    });
  });

  test("without the service URL, nothing is shadowed or logged", async () => {
    delete process.env.BILLING_SERVICE_URL;
    const plan = await metering.planApplicationFee(rental(OLD_STORE, "res_shadow_fresh"));
    assert.equal(plan.applicationFeeCents, 123);
    assert.equal(spies.info.mock.callCount(), 0);
    assert.equal(spies.warn.mock.callCount(), 0);
  });
});
