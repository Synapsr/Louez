import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { BuiltSnapshot, SnapshotKey } from "./build-snapshot";
import { isRecord, SnapshotDataError } from "./snapshot-checks";

// The four snapshot builders on a migrated database, field by field, with each
// result checked against the field lists of the contract's schemas (louez-billing
// docs/api, openapi.yaml StoreSnapshotV1, ReservationSnapshotV1 and the rest).

const STORE = "store_snap";
const OTHER_STORE = "store_snap_other";
const NEW_STORE = "store_snap_new";
const RESERVATION = "res_snap_1";
const CONTEXT = { newStoresFrom: new Date("2027-01-25T00:00:00Z") };
const at = (iso: string) => new Date(iso);

/** The required fields of each contract schema; a snapshot carries exactly these. */
const FIELDS = {
  StoreSnapshotV1: [
    "deleted",
    "slug",
    "createdAt",
    "onboardingCompleted",
    "currency",
    "country",
    "timezone",
    "ownerUserIds",
    "legalCountry",
    "stripeConnect",
    "marketplace",
    "referral",
    "finalReservations",
  ],
  StripeConnect: ["accountId", "chargesEnabled", "onboardingComplete"],
  Marketplace: ["status", "firstPublishedAt", "cohortRank", "lifetimeFeeWaiverAt"],
  Referral: ["referredByStoreId", "referredByUserId", "signupOrigin"],
  ReservationSnapshotV1: [
    "deleted",
    "number",
    "status",
    "source",
    "createdAt",
    "startAt",
    "endAt",
    "billableAt",
    "withdrawnAt",
    "currency",
    "totalInclTaxMinor",
    "insuranceMinor",
    "payments",
  ],
  Payment: [
    "paymentId",
    "kind",
    "method",
    "status",
    "currency",
    "grossMinor",
    "insuranceShareMinor",
    "paidAt",
    "refunds",
    "disputes",
    "stripe",
    "appFee",
  ],
  Refund: ["refundId", "amountMinor", "refundedAt", "via", "stripeRefundId"],
  Dispute: ["disputeId", "amountMinor", "status", "openedAt", "closedAt"],
  StripePaymentRefs: ["accountId", "paymentIntentId", "chargeId", "checkoutSessionId"],
  AppFee: [
    "totalMinor",
    "reservationMinor",
    "marketplaceMinor",
    "baseMinor",
    "policy",
    "metadataVersion",
  ],
  LegacyStoreSnapshotV1: [
    "billingMode",
    "planSlug",
    "subscriptionStatus",
    "stripeSubscriptionId",
    "stripeCustomerId",
    "payAsYouGoConfig",
    "pricingVersion",
    "freeReservationsGranted",
    "freeReservationsUsed",
    "trialDays",
    "discountPercent",
    "discountDurationMonths",
    "stripeCouponId",
    "referralRewards",
  ],
  ReferralReward: [
    "id",
    "referredStoreId",
    "kind",
    "freeReservations",
    "creditMinor",
    "currency",
    "grantedMonth",
    "status",
    "clawedBackAt",
  ],
  LegacyMonthSnapshotV1: ["period", "fees", "invoice"],
  LegacyFeeRow: [
    "id",
    "reservationId",
    "paymentId",
    "dedupKey",
    "source",
    "status",
    "amountMinor",
    "amountReversedMinor",
    "currency",
    "billingMonth",
    "monthlyIndex",
    "stripePaymentIntentId",
    "stripeApplicationFeeId",
    "invoiceId",
    "createdAt",
    "billedAt",
  ],
  LegacyMonthInvoice: [
    "id",
    "status",
    "locationCount",
    "grossAmountMinor",
    "collectedAtSourceMinor",
    "invoicedAmountMinor",
    "usageLocationCount",
    "usageFeeAmountMinor",
    "marketplaceReservationCount",
    "marketplaceFeeAmountMinor",
    "currency",
    "stripeInvoiceId",
    "createdAt",
    "paidAt",
  ],
} as const;

const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;

function record(value: unknown, path: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${path} is an object`);
  return value;
}

function list(value: unknown, path: string): unknown[] {
  assert.ok(Array.isArray(value), `${path} is an array`);
  return value;
}

/** Exactly the schema's fields, every one present, with the contract's formats. */
function hasFields(schema: keyof typeof FIELDS, value: unknown, path: string) {
  const object = record(value, path);
  assert.deepEqual(Object.keys(object).sort(), [...FIELDS[schema]].sort(), `${path} (${schema})`);
  for (const [key, field] of Object.entries(object)) {
    const where = `${path}.${key}`;
    if (key.endsWith("At")) assert.ok(field === null || TIMESTAMP.test(String(field)), where);
    if (key.endsWith("Minor")) assert.ok(Number.isSafeInteger(field), where);
    if (key === "currency") assert.match(String(field), /^[A-Z]{3}$/, where);
    if (key === "country" || key === "legalCountry")
      assert.ok(field === null || /^[A-Z]{2}$/.test(String(field)), where);
  }
  return object;
}

function checkStoreShape(data: unknown) {
  const store = hasFields("StoreSnapshotV1", data, "store");
  hasFields("StripeConnect", store.stripeConnect, "store.stripeConnect");
  hasFields("Marketplace", store.marketplace, "store.marketplace");
  hasFields("Referral", store.referral, "store.referral");
}

function checkReservationShape(data: unknown) {
  const reservation = hasFields("ReservationSnapshotV1", data, "reservation");
  list(reservation.payments, "payments").forEach((value, index) => {
    const path = `payments[${index}]`;
    const payment = hasFields("Payment", value, path);
    list(payment.refunds, `${path}.refunds`).forEach((refund, i) =>
      hasFields("Refund", refund, `${path}.refunds[${i}]`),
    );
    list(payment.disputes, `${path}.disputes`).forEach((dispute, i) =>
      hasFields("Dispute", dispute, `${path}.disputes[${i}]`),
    );
    if (payment.stripe !== null) hasFields("StripePaymentRefs", payment.stripe, `${path}.stripe`);
    if (payment.appFee !== null) hasFields("AppFee", payment.appFee, `${path}.appFee`);
  });
}

function checkLegacyStoreShape(data: unknown) {
  const legacy = hasFields("LegacyStoreSnapshotV1", data, "legacy_store");
  list(legacy.referralRewards, "referralRewards").forEach((reward, index) =>
    hasFields("ReferralReward", reward, `referralRewards[${index}]`),
  );
}

function checkLegacyMonthShape(data: unknown) {
  const month = hasFields("LegacyMonthSnapshotV1", data, "legacy_month");
  list(month.fees, "fees").forEach((fee, index) =>
    hasFields("LegacyFeeRow", fee, `fees[${index}]`),
  );
  if (month.invoice !== null) hasFields("LegacyMonthInvoice", month.invoice, "invoice");
}

function snapshotData(built: BuiltSnapshot): unknown {
  assert.equal(built.kind, "snapshot");
  if (built.kind !== "snapshot") return null;
  // What the relay hashes and sends: JSON with no undefined left behind.
  assert.deepEqual(JSON.parse(JSON.stringify(built.data)), built.data);
  return built.data;
}

describe("billing snapshots (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let snapshots: typeof import("./build-snapshot");

  const build = (key: SnapshotKey) => snapshots.buildSnapshot(louezDb.db, key, CONTEXT);
  const storeKey = (type: SnapshotKey["type"], storeId: string): SnapshotKey => ({
    type,
    aggregateId: storeId,
    storeId,
  });

  before(async () => {
    database = await createTestDatabase("billing_snapshots");
    louezDb = await import("@louez/db");
    snapshots = await import("./build-snapshot");
    const db = louezDb.db;

    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: "user_owner",
        name: "Jeanne Dupont Location",
        slug: "snap-store",
        email: "jeanne@example.com",
        phone: "+33600000000",
        address: "1 rue de la Paix",
        settings: {
          reservationMode: "payment",
          advanceNoticeMinutes: 0,
          country: "fr",
          timezone: "Europe/Paris",
          currency: "eur",
          tax: { enabled: true, defaultRate: 20, displayMode: "inclusive" },
        },
        stripeAccountId: "acct_store",
        stripeChargesEnabled: true,
        stripeOnboardingComplete: true,
        referredByStoreId: "store_referrer",
        referredByUserId: "user_referrer",
        signupOrigin: "referral",
        trialDays: 14,
        discountPercent: 20,
        discountDurationMonths: 3,
        stripeCouponId: "coupon_1",
        onboardingCompleted: true,
        createdAt: at("2026-01-10T08:00:00Z"),
      },
      {
        id: OTHER_STORE,
        userId: "user_other",
        name: "Other",
        slug: "snap-other",
        createdAt: at("2025-06-01T08:00:00Z"),
      },
      {
        id: NEW_STORE,
        userId: "user_new",
        name: "New",
        slug: "snap-new",
        settings: null,
        createdAt: at("2027-02-01T08:00:00Z"),
      },
    ]);

    await db.insert(louezDb.storeMembers).values([
      { id: "member_1", storeId: STORE, userId: "user_owner", role: "owner" },
      { id: "member_2", storeId: STORE, userId: "user_coowner", role: "owner" },
      { id: "member_3", storeId: STORE, userId: "user_staff", role: "member" },
      { id: "member_4", storeId: OTHER_STORE, userId: "user_owner", role: "owner" },
    ]);

    const legal = {
      legalName: "Jeanne Dupont",
      legalForm: "EI",
      companyNumber: "123456789",
      registeredAddress: "1 rue de la Paix",
      registeredPostalCode: "75002",
      registeredCity: "Paris",
      country: "fr",
    };
    await db.insert(louezDb.storeLegalProfiles).values([
      {
        id: "legal_1",
        storeId: STORE,
        ...legal,
        invoicingEnabled: true,
        vatNumber: "FR00123456789",
      },
      { id: "legal_2", storeId: NEW_STORE, ...legal, invoicingEnabled: false },
    ]);

    await db.insert(louezDb.storeMarketplaceChannels).values({
      id: "channel_1",
      storeId: STORE,
      enabledByOwner: true,
      status: "published",
      publishedAt: at("2026-03-01T09:00:00Z"),
      lifetimeFeeWaiverAt: at("2026-03-01T09:00:00Z"),
      cohortRank: 3,
    });

    await db.insert(louezDb.subscriptions).values({
      id: "sub_1",
      storeId: STORE,
      planSlug: "pay_as_you_go",
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1",
      freeReservationsGranted: 2,
      status: "active",
      stripeCustomerId: "cus_platform",
    });

    await db.insert(louezDb.reservations).values({
      id: RESERVATION,
      storeId: STORE,
      customerId: "customer_1",
      number: "R-0001",
      status: "confirmed",
      startDate: at("2026-11-10T09:00:00Z"),
      endDate: at("2026-11-12T09:00:00Z"),
      subtotalAmount: "180.00",
      depositAmount: "300.00",
      totalAmount: "200.00",
      deliveryFee: "10.00",
      tulipInsuranceAmount: "10.00",
      billableAt: at("2026-11-03T10:00:00Z"),
      source: "online",
      customerNotes: "Leave it at the door",
      internalNotes: "Private note",
      deliveryAddress: "2 avenue Foch",
      createdAt: at("2026-10-30T09:00:00Z"),
    });

    const snapshot = { name: "Kayak", description: null, images: [] };
    await db.insert(louezDb.reservationItems).values([
      {
        id: "item_1",
        reservationId: RESERVATION,
        productId: "product_1",
        quantity: 1,
        unitPrice: "180.00",
        depositPerUnit: "300.00",
        totalPrice: "180.00",
        taxRate: "20.00",
        productSnapshot: snapshot,
      },
      {
        id: "item_insurance",
        reservationId: RESERVATION,
        productId: null,
        isCustomItem: true,
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        productSnapshot: { ...snapshot, name: "Insurance" },
      },
    ]);

    await db.insert(louezDb.paymentRequests).values({
      id: "pr_custom",
      storeId: STORE,
      reservationId: RESERVATION,
      token: "token_custom",
      amount: "40.00",
      description: "Cleaning",
      type: "custom",
      status: "completed",
      expiresAt: at("2026-11-30T00:00:00Z"),
    });

    const stripeCharge = (id: string) => ({
      method: "stripe" as const,
      stripePaymentIntentId: `pi_${id}`,
      stripeChargeId: `ch_${id}`,
      stripeCheckoutSessionId: `cs_${id}`,
    });
    await db.insert(louezDb.payments).values([
      {
        // Before PR b: no gross, no fee columns; its fee is in platform_fee.
        id: "p_legacy",
        reservationId: RESERVATION,
        amount: "50.00",
        type: "rental",
        status: "completed",
        ...stripeCharge("legacy"),
        currency: "eur",
        paidAt: at("2026-11-01T08:00:00Z"),
        createdAt: at("2026-11-01T08:00:00Z"),
      },
      {
        // Netted in place by the 50 refunded below.
        id: "p_stripe",
        reservationId: RESERVATION,
        amount: "150.00",
        type: "rental",
        status: "completed",
        ...stripeCharge("1"),
        currency: "eur",
        grossMinor: 20000,
        insuranceShareMinor: 1000,
        origin: "checkout",
        stripeAccountId: "acct_old",
        appFeeTotalMinor: 760,
        appFeeReservationMinor: 760,
        appFeeMarketplaceMinor: 0,
        appFeeBaseMinor: 19000,
        appFeePolicyScope: "default",
        appFeePolicyVersion: 2,
        appFeeMetadataVersion: 4,
        notes: "Paid at the counter",
        paidAt: at("2026-11-03T10:00:00Z"),
        createdAt: at("2026-11-03T10:00:05Z"),
      },
      {
        id: "p_hold",
        reservationId: RESERVATION,
        amount: "300.00",
        type: "deposit_hold",
        method: "stripe",
        status: "authorized",
        stripePaymentIntentId: "pi_hold",
        stripePaymentMethodId: "pm_renter",
        origin: "deposit",
        createdAt: at("2026-11-03T10:00:06Z"),
      },
      {
        id: "p_stripe_refund",
        reservationId: RESERVATION,
        amount: "50.00",
        type: "rental",
        method: "stripe",
        status: "completed",
        stripeRefundId: "re_1",
        refundOfPaymentId: "p_stripe",
        currency: "EUR",
        paidAt: at("2026-11-04T09:00:00Z"),
        createdAt: at("2026-11-04T09:00:00Z"),
      },
      {
        id: "p_cash",
        reservationId: RESERVATION,
        amount: "20.00",
        type: "rental",
        method: "cash",
        status: "completed",
        origin: "manual",
        paidAt: at("2026-11-05T12:00:00Z"),
        createdAt: at("2026-11-05T12:00:00Z"),
      },
      {
        id: "p_cash_refund",
        reservationId: RESERVATION,
        amount: "5.00",
        type: "rental",
        method: "cash",
        status: "completed",
        refundOfPaymentId: "p_cash",
        paidAt: at("2026-11-06T12:00:00Z"),
        createdAt: at("2026-11-06T12:00:00Z"),
      },
      {
        // An extension paid before `origin` existed: named by its activity row.
        id: "p_ext",
        reservationId: RESERVATION,
        amount: "30.00",
        type: "rental",
        status: "completed",
        ...stripeCharge("ext"),
        paidAt: at("2026-11-07T08:00:00Z"),
        createdAt: at("2026-11-07T08:00:00Z"),
      },
      {
        id: "p_req",
        reservationId: RESERVATION,
        amount: "40.00",
        type: "rental",
        status: "completed",
        ...stripeCharge("req"),
        grossMinor: 4000,
        insuranceShareMinor: 0,
        origin: "payment_request",
        paymentRequestId: "pr_custom",
        stripeAccountId: "acct_store",
        appFeeTotalMinor: 0,
        appFeeReservationMinor: 0,
        appFeeMarketplaceMinor: 0,
        appFeeBaseMinor: 0,
        appFeePolicyScope: "fail_closed",
        appFeePolicyVersion: 0,
        appFeeMetadataVersion: 4,
        paidAt: at("2026-11-08T08:00:00Z"),
        createdAt: at("2026-11-08T08:00:00Z"),
      },
    ]);

    await db.insert(louezDb.reservationActivity).values([
      {
        id: "activity_ext",
        reservationId: RESERVATION,
        activityType: "modified",
        metadata: { kind: "rental_extension", status: "confirmed", paymentId: "p_ext" },
      },
      {
        id: "activity_other",
        reservationId: RESERVATION,
        activityType: "payment_added",
        metadata: { kind: "note", paymentId: "p_legacy" },
      },
    ]);

    await db.insert(louezDb.paymentDisputes).values([
      {
        id: "du_1",
        paymentId: "p_stripe",
        reservationId: RESERVATION,
        amountMinor: 15000,
        currency: "EUR",
        status: "open",
        stripeStatus: "needs_response",
        openedAt: at("2026-11-06T10:00:00Z"),
      },
      {
        // An inquiry: no funds withdrawn, never sent.
        id: "du_inquiry",
        paymentId: "p_stripe",
        reservationId: RESERVATION,
        amountMinor: 15000,
        currency: "EUR",
        status: "open",
        stripeStatus: "warning_needs_response",
      },
    ]);

    const fee = { currency: "eur", billingMonth: "2026-11" };
    await db.insert(louezDb.platformFees).values([
      {
        id: "fee_res",
        storeId: STORE,
        reservationId: RESERVATION,
        paymentId: "p_legacy",
        dedupKey: `res:${RESERVATION}`,
        amountCents: 90,
        source: "online",
        status: "collected",
        ...fee,
        monthlyIndex: 1,
        stripePaymentIntentId: "pi_legacy",
        stripeApplicationFeeId: "fee_app_1",
        createdAt: at("2026-11-01T08:00:01Z"),
      },
      {
        id: "fee_mkt",
        storeId: STORE,
        reservationId: RESERVATION,
        dedupKey: `mkt:${RESERVATION}`,
        amountCents: 150,
        source: "marketplace_online",
        status: "collected",
        ...fee,
        stripePaymentIntentId: "pi_legacy",
        createdAt: at("2026-11-01T08:00:02Z"),
      },
      {
        id: "fee_free",
        storeId: STORE,
        reservationId: "res_snap_2",
        dedupKey: "res:res_snap_2",
        amountCents: 0,
        source: "free",
        status: "collected",
        ...fee,
        createdAt: at("2026-11-02T08:00:00Z"),
      },
      {
        id: "fee_free_voided",
        storeId: STORE,
        reservationId: "res_snap_3",
        dedupKey: "res:res_snap_3",
        amountCents: 0,
        source: "free",
        status: "voided",
        ...fee,
        createdAt: at("2026-11-02T09:00:00Z"),
      },
      {
        id: "fee_october",
        storeId: STORE,
        reservationId: "res_snap_4",
        dedupKey: "res:res_snap_4",
        amountCents: 90,
        source: "manual",
        status: "billed",
        currency: "eur",
        billingMonth: "2026-10",
        monthlyIndex: 1,
        createdAt: at("2026-10-15T08:00:00Z"),
      },
      {
        id: "fee_other_store",
        storeId: OTHER_STORE,
        reservationId: "res_snap_5",
        dedupKey: "res:res_snap_5",
        amountCents: 90,
        source: "manual",
        status: "pending",
        ...fee,
        monthlyIndex: 1,
        createdAt: at("2026-11-02T10:00:00Z"),
      },
    ]);

    await db.insert(louezDb.payAsYouGoInvoices).values({
      id: "inv_nov",
      storeId: STORE,
      billingMonth: "2026-11",
      locationCount: 1,
      grossAmountCents: 90,
      collectedAtSourceCents: 90,
      invoicedAmountCents: 0,
      usageLocationCount: 1,
      usageFeeAmountCents: 90,
      marketplaceReservationCount: 1,
      marketplaceFeeAmountCents: 150,
      currency: "eur",
      status: "open",
      stripeInvoiceId: "in_1",
      stripeCustomerId: "cus_platform",
      createdAt: at("2026-12-01T06:00:00Z"),
    });

    await db.insert(louezDb.referralRewards).values([
      {
        id: "reward_1",
        referrerStoreId: STORE,
        referredStoreId: "store_referred",
        qualifyingAmountCents: 5000,
        currency: "eur",
        kind: "free_reservations",
        freeReservations: 1,
        grantedMonth: "2026-09",
        status: "clawed_back",
        clawedBackAt: at("2026-09-20T10:00:00Z"),
      },
      {
        // The store was referred here: the reward is its referrer's.
        id: "reward_2",
        referrerStoreId: "store_referrer",
        referredStoreId: STORE,
        qualifyingAmountCents: 5000,
        kind: "invoice_credit",
        creditCents: 1000,
        grantedMonth: "2026-02",
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("store: ids, settings codes, owners, legal country, Connect, marketplace, referral", async () => {
    const data = snapshotData(await build(storeKey("store", STORE)));
    checkStoreShape(data);
    assert.deepEqual(data, {
      deleted: false,
      slug: "snap-store",
      createdAt: "2026-01-10T08:00:00.000Z",
      onboardingCompleted: true,
      currency: "EUR",
      country: "FR",
      timezone: "Europe/Paris",
      ownerUserIds: ["user_coowner", "user_owner"],
      legalCountry: "FR",
      stripeConnect: { accountId: "acct_store", chargesEnabled: true, onboardingComplete: true },
      marketplace: {
        status: "published",
        firstPublishedAt: "2026-03-01T09:00:00.000Z",
        cohortRank: 3,
        lifetimeFeeWaiverAt: "2026-03-01T09:00:00.000Z",
      },
      referral: {
        referredByStoreId: "store_referrer",
        referredByUserId: "user_referrer",
        signupOrigin: "referral",
      },
      finalReservations: null,
    });
  });

  test("store: what is unknown is null, and invoicing off hides the legal country", async () => {
    const data = snapshotData(await build(storeKey("store", NEW_STORE)));
    checkStoreShape(data);
    assert.deepEqual(data, {
      deleted: false,
      slug: "snap-new",
      createdAt: "2027-02-01T08:00:00.000Z",
      onboardingCompleted: false,
      currency: "EUR",
      country: null,
      timezone: null,
      ownerUserIds: [],
      legalCountry: null,
      stripeConnect: { accountId: null, chargesEnabled: false, onboardingComplete: false },
      marketplace: {
        status: null,
        firstPublishedAt: null,
        cohortRank: null,
        lifetimeFeeWaiverAt: null,
      },
      referral: { referredByStoreId: null, referredByUserId: null, signupOrigin: null },
      finalReservations: null,
    });
  });

  test("reservation: totals, payments by kind, refunds folded, disputes, Stripe refs, fees", async () => {
    const data = snapshotData(
      await build({ type: "reservation", aggregateId: RESERVATION, storeId: STORE }),
    );
    checkReservationShape(data);
    const stripeRefs = (id: string, accountId = "acct_store") => ({
      accountId,
      paymentIntentId: `pi_${id}`,
      chargeId: `ch_${id}`,
      checkoutSessionId: `cs_${id}`,
    });
    assert.deepEqual(data, {
      deleted: false,
      number: "R-0001",
      status: "confirmed",
      source: "online",
      createdAt: "2026-10-30T09:00:00.000Z",
      startAt: "2026-11-10T09:00:00.000Z",
      endAt: "2026-11-12T09:00:00.000Z",
      billableAt: "2026-11-03T10:00:00.000Z",
      withdrawnAt: null,
      // reservations.currency is null: the store's, upper-cased.
      currency: "EUR",
      totalInclTaxMinor: 20000,
      insuranceMinor: 1000,
      payments: [
        {
          paymentId: "p_legacy",
          kind: "rental",
          method: "stripe",
          status: "completed",
          currency: "EUR",
          grossMinor: 5000,
          // insuranceShare(1000, 5000, 20000), computed now for a row without it.
          insuranceShareMinor: 250,
          paidAt: "2026-11-01T08:00:00.000Z",
          refunds: [],
          disputes: [],
          stripe: stripeRefs("legacy"),
          appFee: {
            totalMinor: 240,
            reservationMinor: 90,
            marketplaceMinor: 150,
            baseMinor: 0,
            policy: null,
            metadataVersion: 3,
          },
        },
        {
          paymentId: "p_stripe",
          kind: "rental",
          method: "stripe",
          status: "completed",
          currency: "EUR",
          grossMinor: 20000,
          insuranceShareMinor: 1000,
          paidAt: "2026-11-03T10:00:00.000Z",
          refunds: [
            {
              refundId: "re_1",
              amountMinor: 5000,
              refundedAt: "2026-11-04T09:00:00.000Z",
              via: "stripe",
              stripeRefundId: "re_1",
            },
          ],
          disputes: [
            {
              disputeId: "du_1",
              amountMinor: 15000,
              status: "open",
              openedAt: "2026-11-06T10:00:00.000Z",
              closedAt: null,
            },
          ],
          stripe: stripeRefs("1", "acct_old"),
          appFee: {
            totalMinor: 760,
            reservationMinor: 760,
            marketplaceMinor: 0,
            baseMinor: 19000,
            policy: { scope: "default", version: 2 },
            metadataVersion: 4,
          },
        },
        {
          paymentId: "p_hold",
          kind: "deposit_hold",
          method: "stripe",
          status: "authorized",
          currency: "EUR",
          grossMinor: 30000,
          insuranceShareMinor: 0,
          paidAt: null,
          refunds: [],
          disputes: [],
          stripe: {
            accountId: "acct_store",
            paymentIntentId: "pi_hold",
            chargeId: null,
            checkoutSessionId: null,
          },
          appFee: null,
        },
        {
          paymentId: "p_cash",
          kind: "rental",
          method: "cash",
          status: "completed",
          currency: "EUR",
          grossMinor: 2000,
          insuranceShareMinor: 100,
          paidAt: "2026-11-05T12:00:00.000Z",
          refunds: [
            {
              refundId: "p_cash_refund",
              amountMinor: 500,
              refundedAt: "2026-11-06T12:00:00.000Z",
              via: "manual",
              stripeRefundId: null,
            },
          ],
          disputes: [],
          stripe: null,
          appFee: null,
        },
        {
          paymentId: "p_ext",
          kind: "extension",
          method: "stripe",
          status: "completed",
          currency: "EUR",
          grossMinor: 3000,
          insuranceShareMinor: 150,
          paidAt: "2026-11-07T08:00:00.000Z",
          refunds: [],
          disputes: [],
          stripe: stripeRefs("ext"),
          appFee: null,
        },
        {
          paymentId: "p_req",
          kind: "custom_request",
          method: "stripe",
          status: "completed",
          currency: "EUR",
          grossMinor: 4000,
          insuranceShareMinor: 0,
          paidAt: "2026-11-08T08:00:00.000Z",
          refunds: [],
          disputes: [],
          stripe: stripeRefs("req"),
          appFee: {
            totalMinor: 0,
            reservationMinor: 0,
            marketplaceMinor: 0,
            baseMinor: 0,
            policy: null,
            metadataVersion: 4,
          },
        },
      ],
    });
  });

  test("legacy_store: the frozen tariff, free entries used and rewards as referrer", async () => {
    const data = snapshotData(await build(storeKey("legacy_store", STORE)));
    checkLegacyStoreShape(data);
    assert.deepEqual(data, {
      billingMode: "pay_as_you_go",
      planSlug: "pay_as_you_go",
      subscriptionStatus: "active",
      stripeSubscriptionId: null,
      stripeCustomerId: "cus_platform",
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1",
      freeReservationsGranted: 2,
      freeReservationsUsed: 1,
      trialDays: 14,
      discountPercent: 20,
      discountDurationMonths: 3,
      stripeCouponId: "coupon_1",
      referralRewards: [
        {
          id: "reward_1",
          referredStoreId: "store_referred",
          kind: "free_reservations",
          freeReservations: 1,
          creditMinor: 0,
          currency: "EUR",
          grantedMonth: "2026-09",
          status: "clawed_back",
          clawedBackAt: "2026-09-20T10:00:00.000Z",
        },
      ],
    });

    const bare = snapshotData(await build(storeKey("legacy_store", OTHER_STORE)));
    checkLegacyStoreShape(bare);
    assert.deepEqual(bare, {
      billingMode: null,
      planSlug: null,
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      payAsYouGoConfig: null,
      pricingVersion: null,
      freeReservationsGranted: 0,
      freeReservationsUsed: 0,
      trialDays: 0,
      discountPercent: 0,
      discountDurationMonths: 0,
      stripeCouponId: null,
      referralRewards: [],
    });
  });

  test("legacy_month: the store's fee rows and invoice of that month only", async () => {
    const key = { type: "legacy_month", aggregateId: `${STORE}:2026-11`, storeId: STORE } as const;
    const data = snapshotData(await build(key));
    checkLegacyMonthShape(data);
    const row = {
      paymentId: null,
      amountReversedMinor: 0,
      currency: "EUR",
      billingMonth: "2026-11",
      monthlyIndex: null,
      stripePaymentIntentId: null,
      stripeApplicationFeeId: null,
      invoiceId: null,
      billedAt: null,
    };
    assert.deepEqual(data, {
      period: "2026-11",
      fees: [
        {
          ...row,
          id: "fee_res",
          reservationId: RESERVATION,
          paymentId: "p_legacy",
          dedupKey: `res:${RESERVATION}`,
          source: "online",
          status: "collected",
          amountMinor: 90,
          monthlyIndex: 1,
          stripePaymentIntentId: "pi_legacy",
          stripeApplicationFeeId: "fee_app_1",
          createdAt: "2026-11-01T08:00:01.000Z",
        },
        {
          ...row,
          id: "fee_mkt",
          reservationId: RESERVATION,
          dedupKey: `mkt:${RESERVATION}`,
          source: "marketplace_online",
          status: "collected",
          amountMinor: 150,
          stripePaymentIntentId: "pi_legacy",
          createdAt: "2026-11-01T08:00:02.000Z",
        },
        {
          ...row,
          id: "fee_free",
          reservationId: "res_snap_2",
          dedupKey: "res:res_snap_2",
          source: "free",
          status: "collected",
          amountMinor: 0,
          createdAt: "2026-11-02T08:00:00.000Z",
        },
        {
          ...row,
          id: "fee_free_voided",
          reservationId: "res_snap_3",
          dedupKey: "res:res_snap_3",
          source: "free",
          status: "voided",
          amountMinor: 0,
          createdAt: "2026-11-02T09:00:00.000Z",
        },
      ],
      invoice: {
        id: "inv_nov",
        status: "open",
        locationCount: 1,
        grossAmountMinor: 90,
        collectedAtSourceMinor: 90,
        invoicedAmountMinor: 0,
        usageLocationCount: 1,
        usageFeeAmountMinor: 90,
        marketplaceReservationCount: 1,
        marketplaceFeeAmountMinor: 150,
        currency: "EUR",
        stripeInvoiceId: "in_1",
        createdAt: "2026-12-01T06:00:00.000Z",
        paidAt: null,
      },
    });

    const empty = snapshotData(await build({ ...key, aggregateId: `${STORE}:2026-08` }));
    checkLegacyMonthShape(empty);
    assert.deepEqual(empty, { period: "2026-08", fees: [], invoice: null });
  });

  test("no name, contact, legal identity, renter data or free text in any snapshot", async () => {
    const built = await Promise.all([
      build(storeKey("store", STORE)),
      build({ type: "reservation", aggregateId: RESERVATION, storeId: STORE }),
      build(storeKey("legacy_store", STORE)),
      build({ type: "legacy_month", aggregateId: `${STORE}:2026-11`, storeId: STORE }),
    ]);
    const text = JSON.stringify(built);
    for (const secret of [
      "Jeanne",
      "jeanne@example.com",
      "+33600000000",
      "rue de la Paix",
      "123456789",
      "customer_1",
      "pm_renter",
      "Leave it at the door",
      "Private note",
      "Foch",
      "Kayak",
      "Cleaning",
      "token_custom",
      "Paid at the counter",
    ]) {
      assert.ok(!text.includes(secret), `no "${secret}"`);
    }
  });

  test("an aggregate that no longer exists, or under another store, is missing", async () => {
    for (const type of ["store", "legacy_store"] as const) {
      assert.deepEqual(await build(storeKey(type, "store_gone")), { kind: "missing" });
    }
    assert.deepEqual(
      await build({
        type: "legacy_month",
        aggregateId: "store_gone:2026-11",
        storeId: "store_gone",
      }),
      { kind: "missing" },
    );
    assert.deepEqual(
      await build({ type: "reservation", aggregateId: "res_gone", storeId: STORE }),
      { kind: "missing" },
    );
    assert.deepEqual(
      await build({ type: "reservation", aggregateId: RESERVATION, storeId: OTHER_STORE }),
      { kind: "missing" },
    );
  });

  test("a new store has no legacy aggregates to send", async () => {
    const skip = { kind: "skip", reason: "new_store" };
    assert.deepEqual(await build(storeKey("legacy_store", NEW_STORE)), skip);
    assert.deepEqual(
      await build({
        type: "legacy_month",
        aggregateId: `${NEW_STORE}:2027-02`,
        storeId: NEW_STORE,
      }),
      skip,
    );
  });

  test("a key whose ids disagree is a data error", async () => {
    await assert.rejects(
      build({ type: "legacy_month", aggregateId: `${OTHER_STORE}:2026-11`, storeId: STORE }),
      SnapshotDataError,
    );
    await assert.rejects(
      build({ type: "store", aggregateId: OTHER_STORE, storeId: STORE }),
      SnapshotDataError,
    );
  });

  test("builds the same snapshot inside a transaction", async () => {
    const key = { type: "reservation", aggregateId: RESERVATION, storeId: STORE } as const;
    const inTransaction = await louezDb.db.transaction((tx) =>
      snapshots.buildSnapshot(tx, key, CONTEXT),
    );
    assert.deepEqual(inTransaction, await build(key));
  });

  test("more payments than the contract allows is a data error naming the reservation", async () => {
    const id = "res_snap_many";
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: OTHER_STORE,
      customerId: "customer_2",
      number: "R-0002",
      status: "pending",
      startDate: at("2026-11-10T09:00:00Z"),
      endDate: at("2026-11-12T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.db.insert(louezDb.payments).values(
      Array.from({ length: 201 }, (_, index) => ({
        id: `p_many_${index}`,
        reservationId: id,
        amount: "0.00",
        type: "rental" as const,
        method: "stripe" as const,
        status: "cancelled" as const,
        stripeCheckoutSessionId: `cs_many_${index}`,
      })),
    );
    await assert.rejects(
      build({ type: "reservation", aggregateId: id, storeId: OTHER_STORE }),
      (error: unknown) =>
        error instanceof SnapshotDataError &&
        error.message.startsWith(`reservation ${id}: payments has 201 entries`),
    );
  });
});
