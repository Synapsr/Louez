import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "@/lib/billing-sync/fake-billing-service.fixtures";

// What billing_get_status reads (packages/api ports.billing), from the billing
// pages' own functions, per policy type: the billing service, Louez's legacy
// pay-as-you-go, and an instance that bills nobody. The billing service is a
// fake; no Stripe key is set, so nothing reaches Stripe.

process.env.STRIPE_SECRET_KEY = "";

/** After the fake's BILLING_NEW_STORES_FROM, 2027-01-25: a store created since is new. */
const NOW = new Date("2027-02-10T09:00:00Z");
const SERVICE_STORE = "bp_store_service";
const DOWN_STORE = "bp_store_down";
const LEGACY_STORE = "bp_store_legacy";

const policy = (storeId: string) => ({
  schema: "louez.billing.policy/1",
  storeId,
  version: 1,
  effectiveFrom: "2026-12-01T00:00:00Z",
  issuedAt: "2026-11-20T10:00:00Z",
  newStoresCreatedFrom: null,
  offerKey: "test-commission",
  invoicing: "service",
  currency: "EUR",
  applicationFee: { kind: "none" },
  marketplaceFeeMinor: 0,
  reservations: { allowed: false, reason: "payment_method_required" },
  notice: null,
  stripeCustomerId: null,
  labels: {
    offer: { fr: "Commission de test", en: "Test commission" },
    notice: { fr: "Ajoutez une carte.", en: "Add a card." },
  },
});

const OVERVIEW = {
  at: NOW.toISOString(),
  timeZone: "Europe/Paris",
  tariff: { kind: "offer", label: "Test" },
  card: "saved",
  savedCard: { brand: "visa", last4: "4242", expMonth: 3, expYear: 2028, expired: false },
  notice: null,
  blocked: null,
  month: {
    period: "2027-02",
    currencies: [{ currency: "EUR", atSourceMinor: 250, dueMinor: 123 }],
    statementAt: "2027-03-01T00:00:00.000Z",
  },
  balance: { currency: "EUR", amountMinor: 123, limitMinor: 5000, standing: "ok" },
  cardSetupUnavailable: null,
};

describe("billing port (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let port: typeof import("./billing-port").billingPort;
  let usage: typeof import("@/lib/pay-as-you-go/metering");

  before(async () => {
    database = await createTestDatabase("billing_port");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    ({ billingPort: port } = await import("./billing-port"));
    usage = await import("@/lib/pay-as-you-go/metering");

    const store = (id: string, createdAt: string) => ({
      id,
      userId: "bp_owner",
      name: id,
      slug: id.replaceAll("_", "-"),
      settings: {
        reservationMode: "request" as const,
        advanceNoticeMinutes: 0,
        currency: "EUR",
        country: "FR",
      },
      createdAt: new Date(createdAt),
    });
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        store(SERVICE_STORE, "2027-02-01T00:00:00Z"),
        store(DOWN_STORE, "2027-02-01T00:00:00Z"),
        store(LEGACY_STORE, "2026-06-01T00:00:00Z"),
      ]);
    await louezDb.db.insert(louezDb.billingPolicies).values(
      [SERVICE_STORE, DOWN_STORE].map((storeId) => ({
        storeId,
        version: 1,
        effectiveFrom: new Date("2026-12-01T00:00:00Z"),
        body: policy(storeId),
      })),
    );

    // The legacy store pays per reservation, on its own frozen ladder.
    await louezDb.db.insert(louezDb.subscriptions).values({
      storeId: LEGACY_STORE,
      planSlug: "pay_as_you_go",
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: {
        flatRateCents: null,
        tiers: [
          { upToCount: 10, priceCents: 90 },
          { upToCount: null, priceCents: 50 },
        ],
        currency: "eur",
      },
      freeReservationsGranted: 5,
    });
    const fee = (index: number, source: "manual" | "online", status: "pending" | "collected") => ({
      storeId: LEGACY_STORE,
      reservationId: `bp_res_${index}`,
      dedupKey: `res:bp_res_${index}`,
      amountCents: 90,
      currency: "eur",
      source,
      status,
      billingMonth: "2027-02",
    });
    await louezDb.db
      .insert(louezDb.platformFees)
      .values([
        fee(1, "manual", "pending"),
        fee(2, "manual", "pending"),
        fee(3, "online", "collected"),
      ]);
    await louezDb.db.insert(louezDb.payAsYouGoInvoices).values({
      storeId: LEGACY_STORE,
      billingMonth: "2027-01",
      locationCount: 4,
      grossAmountCents: 300,
      collectedAtSourceCents: 50,
      invoicedAmountCents: 250,
      currency: "eur",
      status: "paid",
      paidAt: new Date("2027-02-03T10:00:00Z"),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  test("a store the billing service bills: its offer, card, month, balance and card setup", async () => {
    service.handle(`/stores/${SERVICE_STORE}/billing`, () => ({ status: 200, body: OVERVIEW }));
    const status = await port.status({ storeId: SERVICE_STORE, locale: "en", now: NOW });
    assert.equal(status.billing, "service");
    assert.equal(status.mode, "pay_as_you_go");
    assert.equal(status.plan, null);
    assert.equal(status.offer, "Test commission");
    assert.equal(status.notice, "Add a card.");
    assert.deepEqual(status.card, {
      state: "saved",
      brand: "visa",
      last4: "4242",
      expMonth: 3,
      expYear: 2028,
      expired: false,
    });
    assert.deepEqual(status.service, {
      reachable: true,
      month: {
        period: "2027-02",
        statementAt: "2027-03-01T00:00:00.000Z",
        currencies: [
          {
            atSource: { amount: "2.50", currency: "EUR" },
            due: { amount: "1.23", currency: "EUR" },
          },
        ],
      },
      balance: {
        owed: { amount: "1.23", currency: "EUR" },
        limit: { amount: "50.00", currency: "EUR" },
        standing: "ok",
      },
    });
    assert.equal(status.cardSetupOpen, true);
    assert.equal(await port.billedByService(SERVICE_STORE, NOW), true);

    // The service's own reason not to open a card setup is passed on.
    service.handle(`/stores/${SERVICE_STORE}/billing`, () => ({
      status: 200,
      body: { ...OVERVIEW, cardSetupUnavailable: "in_louez" },
    }));
    const inLouez = await port.status({ storeId: SERVICE_STORE, locale: "fr", now: NOW });
    assert.equal(inLouez.offer, "Commission de test");
    assert.equal(inLouez.cardSetupOpen, false);
    assert.equal(inLouez.cardSetupBlocked, "in_louez");
  });

  test("a billing service that does not answer: the offer stays, the rest says it could not be read", async () => {
    service.handle(`/stores/${DOWN_STORE}/billing`, () => ({
      status: 500,
      body: { code: "internal_error" },
    }));
    const status = await port.status({ storeId: DOWN_STORE, locale: "en", now: NOW });
    assert.equal(status.billing, "service");
    assert.equal(status.offer, "Test commission");
    assert.equal(status.card, null);
    assert.deepEqual(status.service, { reachable: false, month: null, balance: null });
  });

  test("a store Louez's legacy code bills: its ladder, this month and its invoices, as the plan page reads them", async () => {
    const status = await port.status({ storeId: LEGACY_STORE, locale: "en", now: NOW });
    assert.equal(status.billing, "legacy");
    assert.equal(status.mode, "pay_as_you_go");
    assert.equal(await port.billedByService(LEGACY_STORE, NOW), false);
    assert.equal(status.cardSetupBlocked, "not_billed_by_service");

    const month = await usage.getCurrentMonthUsage(LEGACY_STORE, NOW);
    assert.deepEqual(status.payAsYouGo, {
      bands: [
        { from: 1, to: 10, fee: { amount: "0.90", currency: "EUR" } },
        { from: 11, to: null, fee: { amount: "0.50", currency: "EUR" } },
      ],
      freeReservations: { granted: 5, remaining: 5 },
      month: {
        period: "2027-02",
        reservations: month.locationCount,
        fees: { amount: (month.grossCents / 100).toFixed(2), currency: "EUR" },
        collectedAtSource: { amount: "0.90", currency: "EUR" },
        due: { amount: (month.dueCents / 100).toFixed(2), currency: "EUR" },
      },
    });
    assert.equal(month.locationCount, 3);
    // No platform customer yet: no card, and Stripe is never asked.
    assert.equal(status.card?.state, "missing");
    assert.deepEqual(status.invoices, [
      {
        period: "2027-01",
        amount: { amount: "2.50", currency: "EUR" },
        status: "paid",
        paidAt: new Date("2027-02-03T10:00:00Z"),
      },
    ]);
  });

  test("an instance that bills nobody says so, and reads nothing", async () => {
    const billing = process.env.LOUEZ_BILLING;
    delete process.env.LOUEZ_BILLING;
    try {
      const status = await port.status({ storeId: SERVICE_STORE, locale: "en", now: NOW });
      assert.equal(status.billing, "none");
      assert.equal(status.card, null);
      assert.equal(await port.billedByService(SERVICE_STORE, NOW), false);
    } finally {
      process.env.LOUEZ_BILLING = billing;
    }
  });
});
