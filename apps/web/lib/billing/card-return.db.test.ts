import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "@/lib/billing-sync/fake-billing-service.fixtures";

// The owner's return from Stripe Checkout with a card (louez-billing docs/api, README
// §10 step 5), and who sees the billing pages (§10, §12), against a fake billing
// service. The policy uses the public test values of fees.md (Q33): 250 bps, a 150
// marketplace fee.

/** After the fake's BILLING_NEW_STORES_FROM, 2027-01-25: a store created since is new. */
const NOW = new Date("2027-02-10T09:00:00Z");
const NEW_STORE = "2027-02-01T00:00:00Z";
const LEGACY_STORE = "2026-06-01T00:00:00Z";

const policy = (storeId: string, version = 1) => ({
  schema: "louez.billing.policy/1",
  storeId,
  version,
  effectiveFrom: "2026-12-01T00:00:00Z",
  issuedAt: "2026-11-20T10:00:00Z",
  newStoresCreatedFrom: null,
  offerKey: "test-commission",
  invoicing: "service",
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
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Commission de test", en: "Test commission" }, notice: null },
});

const storeSet = (storeId: string, policies: unknown[]) => ({
  schema: "louez.billing.store-policies/1",
  storeId,
  generatedAt: new Date().toISOString(),
  history: false,
  policies,
});

describe("card return (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let cardReturn: typeof import("./card-return");
  let access: typeof import("./billing-access");

  const STORES = [
    "ret_store_owner",
    "ret_store_pending",
    "ret_store_foreign",
    "ret_store_invalid",
    "ret_store_conflict",
    "ret_store_down",
    "ret_store_alert",
  ];

  before(async () => {
    database = await createTestDatabase("card_return");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    cardReturn = await import("./card-return");
    access = await import("./billing-access");
    // The service bills a new store (fail closed until it has a version); a store
    // created before the cutoff, without a version, is legacy.
    const store = (id: string, createdAt: string) => ({
      id,
      userId: "user_owner",
      name: id,
      slug: id.replaceAll("_", "-"),
      createdAt: new Date(createdAt),
    });
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        ...STORES.map((id) => store(id, NEW_STORE)),
        store("ret_store_legacy", LEGACY_STORE),
      ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  const session = (storeId: string) => `cs_test_${storeId}`;

  /** The service's answer to the return of `storeId`'s Checkout. */
  const finishes = (storeId: string, status: "saved" | "replaced" | "pending") =>
    service.handle(`/stores/${storeId}/billing/card-setups/${session(storeId)}/finish`, () => ({
      status: 200,
      body: { status },
    }));

  /** The return of `storeId`'s Checkout; `after` keeps its tasks, as Next.js runs them later. */
  const returning = (storeId: string) => {
    const afterTasks: Array<() => Promise<void>> = [];
    const outcome = () =>
      cardReturn.finishCardReturn({
        storeId,
        checkoutSessionId: session(storeId),
        after: (task) => {
          afterTasks.push(task);
        },
      });
    return { afterTasks, outcome };
  };

  const requestsFor = (storeId: string) =>
    service.requests
      .filter((request) => request.target.includes(`/stores/${storeId}/`))
      .map((request) => `${request.method} ${request.target.replace("/api/v1/louez", "")}`);

  test("reads the Checkout Session id Stripe puts in the return URL, and nothing else", () => {
    assert.equal(cardReturn.readCheckoutSessionId("cs_test_a1B2"), "cs_test_a1B2");
    for (const value of [null, undefined, "", "pi_123", "cs_", "cs_a/b", "cs_a?b=1"]) {
      assert.equal(cardReturn.readCheckoutSessionId(value), null, String(value));
    }
  });

  test("a saved card pulls the store's policies and says billing is up to date", async () => {
    finishes("ret_store_owner", "saved");
    service.handle("/stores/ret_store_owner/policies", () => ({
      status: 200,
      body: storeSet("ret_store_owner", [policy("ret_store_owner")]),
    }));
    assert.equal(await returning("ret_store_owner").outcome(), "refreshed");
    assert.deepEqual(requestsFor("ret_store_owner"), [
      `POST /stores/ret_store_owner/billing/card-setups/${session("ret_store_owner")}/finish`,
      "GET /stores/ret_store_owner/policies",
    ]);
    const finish = service.requests.find((request) => request.target.endsWith("/finish"));
    assert.ok(finish?.verified, "the call is signed");
    assert.deepEqual(finish?.json(), {});
    const rows = await louezDb.db.select().from(louezDb.billingPolicies);
    assert.ok(rows.some((row) => row.storeId === "ret_store_owner" && row.version === 1));
  });

  test("a card Stripe has not confirmed, or a session of another store, pulls nothing", async () => {
    finishes("ret_store_pending", "pending");
    service.handle(
      `/stores/ret_store_foreign/billing/card-setups/${session("ret_store_foreign")}/finish`,
      () => ({
        status: 404,
        body: { code: "not_found" },
      }),
    );
    for (const storeId of ["ret_store_pending", "ret_store_foreign"]) {
      assert.equal(await returning(storeId).outcome(), "pending", storeId);
      assert.equal(requestsFor(storeId).length, 1, storeId);
    }
  });

  test("a pull that cached nothing usable says the change may take a while", async () => {
    // Every version refused by the schema.
    service.handle("/stores/ret_store_invalid/policies", () => ({
      status: 200,
      body: storeSet("ret_store_invalid", [
        { ...policy("ret_store_invalid"), invoicing: "partner" },
      ]),
    }));
    // A known version that arrives with other content: the stored row is kept.
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: "ret_store_conflict",
      version: 1,
      effectiveFrom: new Date("2026-12-01T00:00:00Z"),
      body: policy("ret_store_conflict"),
    });
    service.handle("/stores/ret_store_conflict/policies", () => ({
      status: 200,
      body: storeSet("ret_store_conflict", [
        { ...policy("ret_store_conflict"), marketplaceFeeMinor: 0 },
      ]),
    }));
    // The service fails.
    service.handle("/stores/ret_store_down/policies", () => ({
      status: 500,
      body: { code: "internal_error" },
    }));

    for (const storeId of ["ret_store_invalid", "ret_store_conflict", "ret_store_down"]) {
      finishes(storeId, "saved");
      assert.equal(await returning(storeId).outcome(), "pending", storeId);
    }
  });

  test("an alert's Discord part runs after the answer, not before it", async () => {
    finishes("ret_store_alert", "replaced");
    service.handle("/stores/ret_store_alert/policies", () => ({
      status: 200,
      body: storeSet("ret_store_alert", [{ ...policy("ret_store_alert"), currency: "euro" }]),
    }));
    const visit = returning("ret_store_alert");
    assert.equal(await visit.outcome(), "pending");
    // policies_invalid: its Discord slot and webhook wait for `after`.
    assert.equal(visit.afterTasks.length, 1);
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.equal(state?.alerts?.policies_invalid, undefined);

    await Promise.all(visit.afterTasks.map((task) => task()));
    const [later] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.ok(later?.alerts?.policies_invalid, "the task claims the hourly Discord slot");
  });

  test("the owner of a store the service bills sees its billing pages; a platform admin reads them", async () => {
    // ret_store_owner has a version since the first return; ret_store_legacy is legacy.
    const viewer = async (storeId: string, role: "owner" | "member", admin: boolean) =>
      (await access.getBillingAccess({ id: storeId, role }, admin, NOW))?.role ?? null;
    assert.equal(await viewer("ret_store_owner", "owner", false), "owner");
    assert.equal(await viewer("ret_store_owner", "member", false), null);
    assert.equal(await viewer("ret_store_legacy", "owner", false), null);
    assert.equal(await viewer("ret_store_legacy", "member", true), "platform_admin");
  });
});
