import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type { MemberRole } from "@louez/utils";

import type { BillingCardFlagSource } from "./billing-card-step";

// Who sees the onboarding's "Billing card" step in service mode (M2 plan L6;
// louez-billing docs/api, README §8.3 and §10 step 1), read from the policy cache. The
// policies use the public test values of fees.md (Q33): 250 bps, a 150 marketplace fee.

const NEW_STORES_FROM = "2027-01-25T00:00:00Z";
/** After the cutoff, before the `*` version below takes effect: a new store fails closed. */
const NOW = new Date("2027-02-10T09:00:00Z");
/** Once the `*` version is in force. */
const LATER = new Date("2027-03-05T09:00:00Z");
/** Before the cutoff, as everywhere during M2: every store is legacy. */
const BEFORE_CUTOFF = new Date("2026-12-01T09:00:00Z");

type Reservations =
  | { allowed: true }
  | { allowed: false; reason: "payment_method_required" | "payment_overdue" | "suspended" };

const CARD_REQUIRED: Reservations = { allowed: false, reason: "payment_method_required" };

const policy = (
  storeId: string,
  invoicing: "service" | "louez_legacy" | "none",
  reservations: Reservations,
  dates: { effectiveFrom: string; newStoresCreatedFrom: string | null } = {
    effectiveFrom: "2026-12-01T00:00:00Z",
    newStoresCreatedFrom: null,
  },
) => ({
  schema: "louez.billing.policy/1",
  storeId,
  version: 1,
  ...dates,
  issuedAt: "2026-11-20T10:00:00Z",
  offerKey: "test-commission",
  invoicing,
  currency: "EUR",
  applicationFee: {
    kind: "percent",
    rateBps: 250,
    minMinor: 50,
    maxMinor: 300,
    excludeInsurance: false,
    appliesTo: ["rental", "custom_request"],
  },
  marketplaceFeeMinor: 150,
  reservations,
  notice: reservations.allowed ? null : { kind: "payment_method_missing", blockAt: null },
  stripeCustomerId: null,
  labels: {
    offer: { fr: "Commission de test", en: "Test commission" },
    notice: reservations.allowed ? null : { fr: "Ajoutez une carte.", en: "Add a card." },
  },
});

/** A flag source that answers `answer` and counts the questions. */
function flags(answer: () => Promise<boolean | undefined> = async () => true) {
  let asked = 0;
  const source: BillingCardFlagSource = {
    apiKey: "phc_test",
    client: () => ({
      isFeatureEnabled: async () => {
        asked += 1;
        return answer();
      },
    }),
  };
  return { source, asked: () => asked };
}

describe("billing card step (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let step: typeof import("./billing-card-step");
  const names = [
    "LOUEZ_BILLING",
    "BILLING_SERVICE_URL",
    "BILLING_NEW_STORES_FROM",
    "BILLING_GATE_DISABLED",
  ] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));

  before(async () => {
    database = await createTestDatabase("billing_card_step");
    louezDb = await import("@louez/db");
    step = await import("./billing-card-step");
    const store = (id: string, createdAt: string) => ({
      id,
      userId: "user_owner",
      name: id,
      slug: id.replaceAll("_", "-"),
      createdAt: new Date(createdAt),
    });
    await louezDb.db.insert(louezDb.stores).values([
      // Legacy: before the cutoff, with a louez_legacy version of its own or none.
      store("bcs_legacy", "2026-05-01T00:00:00Z"),
      store("bcs_plain_old", "2026-06-01T00:00:00Z"),
      store("bcs_none", "2026-06-01T00:00:00Z"),
      // Billed by the service: its own version, or new and not processed yet.
      store("bcs_needs_card", "2027-02-01T00:00:00Z"),
      store("bcs_has_card", "2027-02-01T00:00:00Z"),
      store("bcs_overdue", "2027-02-01T00:00:00Z"),
      store("bcs_fresh", "2027-02-09T00:00:00Z"),
    ]);
    const rows = [
      policy("bcs_legacy", "louez_legacy", { allowed: true }),
      policy("bcs_none", "none", { allowed: true }),
      policy("bcs_needs_card", "service", CARD_REQUIRED),
      policy("bcs_has_card", "service", { allowed: true }),
      policy("bcs_overdue", "service", { allowed: false, reason: "payment_overdue" }),
      // A `*` version in force from LATER's month on that asks no card.
      policy(
        "*",
        "service",
        { allowed: true },
        {
          effectiveFrom: "2027-03-01T00:00:00Z",
          newStoresCreatedFrom: "2027-03-01T00:00:00Z",
        },
      ),
    ];
    await louezDb.db.insert(louezDb.billingPolicies).values(
      rows.map((body) => ({
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
    delete process.env.BILLING_GATE_DISABLED;
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** Whether `role` (a platform admin with `admin`) sees the step for `storeId`, or for no store yet. */
  const shows = (
    storeId: string | null,
    options: {
      role?: MemberRole;
      admin?: boolean;
      now?: Date;
      flags?: BillingCardFlagSource;
    } = {},
  ) =>
    step.showsBillingCardStep({
      userId: "user_owner",
      isPlatformAdmin: options.admin ?? false,
      stores: [storeId ? { id: storeId, role: options.role ?? "owner" } : null],
      now: options.now ?? NOW,
      flags: options.flags ?? flags().source,
    });

  /** Whether the onboarding's step list has the step, with `storeId` active. */
  const listed = (
    storeId: string | null,
    onboardingCompleted: boolean,
    options: { now?: Date; flags?: BillingCardFlagSource } = {},
  ) =>
    step.showsBillingCardStep({
      userId: "user_owner",
      isPlatformAdmin: false,
      stores: step.onboardingBillingCardStores(
        storeId ? { id: storeId, role: "owner", onboardingCompleted } : null,
      ),
      now: options.now ?? NOW,
      flags: options.flags ?? flags().source,
    });

  test("the owner of a store the service bills, which asks for a card, sees the step", async () => {
    assert.equal(await shows("bcs_needs_card"), true);
  });

  test("a new store the service has not processed yet fails closed: its owner sees the step", async () => {
    assert.equal(await shows("bcs_fresh"), true);
  });

  test("before the store exists, its creator sees the step when a store created now would ask for a card", async () => {
    assert.equal(await shows(null), true, "new and fail closed");
    assert.equal(
      await shows(null, { admin: true }),
      true,
      "a platform admin owns the store they create",
    );
  });

  test("hidden for legacy stores, with a louez_legacy version, none, or invoicing none", async () => {
    for (const storeId of ["bcs_legacy", "bcs_plain_old", "bcs_none"]) {
      const flag = flags();
      assert.equal(await shows(storeId, { flags: flag.source }), false, storeId);
      assert.equal(flag.asked(), 0, `${storeId}: PostHog is not asked`);
    }
  });

  test("hidden before the cutoff, as during M2, for a store to create and an existing one", async () => {
    assert.equal(await shows(null, { now: BEFORE_CUTOFF }), false);
    assert.equal(await shows("bcs_legacy", { now: BEFORE_CUTOFF }), false);
  });

  test("hidden once a card is on file, and for a block a card does not lift", async () => {
    assert.equal(await shows("bcs_has_card"), false);
    assert.equal(await shows("bcs_overdue"), false);
  });

  test("hidden when the `*` version in force asks no card", async () => {
    assert.equal(await shows(null, { now: LATER }), false);
    assert.equal(await shows("bcs_fresh", { now: LATER }), false);
    // A store's own version still decides for that store.
    assert.equal(await shows("bcs_needs_card", { now: LATER }), true);
  });

  test("hidden for a member and for a platform admin's read-only session", async () => {
    assert.equal(await shows("bcs_needs_card", { role: "member" }), false);
    assert.equal(await shows("bcs_needs_card", { role: "platform_admin", admin: true }), false);
    assert.equal(await shows("bcs_needs_card", { role: "member", admin: true }), false);
    // A platform admin who owns the store is its owner.
    assert.equal(await shows("bcs_needs_card", { role: "owner", admin: true }), true);
  });

  test("hidden while BILLING_GATE_DISABLED lets reservations through, as the banners are", async () => {
    process.env.BILLING_GATE_DISABLED = "true";
    assert.equal(await shows("bcs_needs_card"), false);
    assert.equal(await shows("bcs_fresh"), false);
    assert.equal(await shows(null), false);
  });

  test("the step list has it once the payment step has completed the flow's store", async () => {
    // At LATER, a store created now would not need a card, but this one still does: a
    // full load of the step page (back from Stripe) lists the step the page shows.
    assert.equal(await listed("bcs_needs_card", true, { now: LATER }), true);
    assert.equal(await listed("bcs_needs_card", false, { now: LATER }), true);
    assert.equal(await listed("bcs_has_card", true, { now: LATER }), false);
  });

  test("with a completed store active, a new store on the way still gets the step", async () => {
    // An earlier store with its card on file, while a store created now fails closed.
    assert.equal(await listed("bcs_has_card", true), true);
    // A draft is the flow's own store, and it decides.
    assert.equal(await listed("bcs_has_card", false), false);
    assert.equal(await listed(null, false), true);
  });

  test("with several stores to decide for, PostHog is asked once, and only if one asks", async () => {
    const flag = flags();
    assert.equal(await listed("bcs_needs_card", true, { flags: flag.source }), true);
    assert.equal(flag.asked(), 1);

    const none = flags();
    assert.equal(await listed("bcs_has_card", true, { now: LATER, flags: none.source }), false);
    assert.equal(none.asked(), 0);
  });

  test("the flag fails closed: false, unknown or failing hides a step the policy asks for", async () => {
    const answers: ReadonlyArray<readonly [string, () => Promise<boolean | undefined>]> = [
      ["false", async () => false],
      ["unknown", async () => undefined],
      [
        "error",
        async () => {
          throw new Error("PostHog is down");
        },
      ],
    ];
    for (const [name, answer] of answers) {
      for (const storeId of ["bcs_needs_card", null]) {
        const flag = flags(answer);
        assert.equal(await shows(storeId, { flags: flag.source }), false, `${name} ${storeId}`);
        assert.equal(flag.asked(), 1);
      }
    }
    const noKey: BillingCardFlagSource = { ...flags().source, apiKey: undefined };
    assert.equal(await shows("bcs_needs_card", { flags: noKey }), false, "no PostHog key");
  });
});
