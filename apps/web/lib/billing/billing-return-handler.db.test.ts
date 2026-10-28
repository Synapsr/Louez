import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type { MemberRole } from "@louez/utils";

import type { BillingReturnRequest } from "@/lib/billing/billing-return-handler";
import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "@/lib/billing-sync/fake-billing-service.fixtures";

// "Back to Louez" from the billing pages (louez-billing docs/api, README §10 step 4,
// §12) against a fake billing service. The policy uses the public test values of
// fees.md (Q33): 250 bps, a 150 marketplace fee.

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

describe("billing return route (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let handler: typeof import("./billing-return-handler");

  before(async () => {
    database = await createTestDatabase("billing_return");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    handler = await import("./billing-return-handler");
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
        ...[
          "ret_store_member",
          "ret_store_owner",
          "ret_store_admin",
          "ret_store_admin_mbr",
          "ret_store_invalid",
          "ret_store_conflict",
          "ret_store_down",
          "ret_store_alert",
        ].map((id) => store(id, NEW_STORE)),
        store("ret_store_legacy", LEGACY_STORE),
      ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  /**
   * An owner of `storeId` coming back, or a platform admin with `admin`; `after` keeps
   * its tasks, as Next.js runs them later.
   */
  const returning = (
    storeId: string,
    overrides: Partial<BillingReturnRequest> & { admin?: boolean } = {},
  ) => {
    const calls: string[] = [];
    const afterTasks: Array<() => Promise<void>> = [];
    const { admin = false, ...rest } = overrides;
    const request: BillingReturnRequest = {
      connection: async () => {
        calls.push("connection");
      },
      after: (task) => {
        afterTasks.push(task);
      },
      getSession: async () => {
        calls.push("session");
        return { userId: "user_owner", email: "someone@example.test" };
      },
      getStore: async () => ({ id: storeId, role: "owner" }),
      isPlatformAdmin: () => admin,
      now: () => NOW,
      ...rest,
    };
    return { calls, afterTasks, answer: () => handler.answerBillingReturn(request) };
  };

  const requestsFor = (storeId: string) =>
    service.requests.filter((request) => request.target.includes(`/stores/${storeId}/`));

  const withEnv = async (values: Record<string, string | undefined>, run: () => Promise<void>) => {
    const previous = Object.keys(values).map((name) => [name, process.env[name]] as const);
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    try {
      await run();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  test("outside service mode the route answers 404 and reads no session", async () => {
    for (const env of [
      { LOUEZ_BILLING: undefined },
      { LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: undefined },
    ]) {
      await withEnv(env, async () => {
        const visit = returning("ret_store_off");
        assert.deepEqual(await visit.answer(), { kind: "not_found" });
        assert.deepEqual(visit.calls, ["connection"]);
      });
    }
    assert.deepEqual(requestsFor("ret_store_off"), []);
  });

  test("the route decides nothing before connection(), so `next build` cannot prerender its 404", async () => {
    // During a prerender with cacheComponents, connection() never resolves.
    await withEnv({ LOUEZ_BILLING: undefined }, async () => {
      const visit = returning("ret_store_build", { connection: () => new Promise(() => {}) });
      const settled = await Promise.race([
        visit.answer().then(() => "answered"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
      ]);
      assert.equal(settled, "waiting");
    });
  });

  test("a signed-out visitor goes to the login page, then back to the route", async () => {
    const visit = returning("ret_store_anon", { getSession: async () => null });
    assert.deepEqual(await visit.answer(), {
      kind: "redirect",
      to: "/login?callbackUrl=%2Fdashboard%2Fbilling%2Freturn",
    });
  });

  test("a user without a store goes to the onboarding", async () => {
    const visit = returning("ret_store_none", { getStore: async () => null });
    assert.deepEqual(await visit.answer(), { kind: "redirect", to: "/onboarding" });
  });

  test("whoever the hand-off turns away goes to the settings without a toast, and nothing is pulled", async () => {
    // A member, and the owner of a legacy store (D4: no owner sees billing before M3).
    const visitors: ReadonlyArray<{ readonly storeId: string; readonly role: MemberRole }> = [
      { storeId: "ret_store_member", role: "member" },
      { storeId: "ret_store_legacy", role: "owner" },
    ];
    for (const { storeId, role } of visitors) {
      service.handle(`/stores/${storeId}/policies`, () => ({
        status: 200,
        body: storeSet(storeId, [policy(storeId)]),
      }));
      const visit = returning(storeId, { getStore: async () => ({ id: storeId, role }) });
      assert.deepEqual(
        await visit.answer(),
        { kind: "redirect", to: "/dashboard/settings" },
        storeId,
      );
      assert.deepEqual(requestsFor(storeId), [], storeId);
    }
  });

  test("an owner's or a platform admin's return pulls the store and says billing is up to date", async () => {
    // A platform admin who is a plain member of the store gets a platform_admin token too.
    const visitors: ReadonlyArray<{
      readonly storeId: string;
      readonly role: MemberRole;
      readonly admin: boolean;
    }> = [
      { storeId: "ret_store_owner", role: "owner", admin: false },
      { storeId: "ret_store_admin", role: "platform_admin", admin: true },
      { storeId: "ret_store_admin_mbr", role: "member", admin: true },
    ];
    for (const { storeId, role, admin } of visitors) {
      service.handle(`/stores/${storeId}/policies`, () => ({
        status: 200,
        body: storeSet(storeId, [policy(storeId)]),
      }));
      const visit = returning(storeId, { getStore: async () => ({ id: storeId, role }), admin });
      assert.deepEqual(await visit.answer(), {
        kind: "redirect",
        to: "/dashboard/settings/billing?billing=refreshed",
      });
      assert.equal(requestsFor(storeId).length, 1);
      const rows = await louezDb.db.select().from(louezDb.billingPolicies);
      assert.ok(rows.some((row) => row.storeId === storeId && row.version === 1));
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
      const visit = returning(storeId);
      assert.deepEqual(
        await visit.answer(),
        { kind: "redirect", to: "/dashboard/settings/billing?billing=pending" },
        storeId,
      );
    }
  });

  test("an alert's Discord part runs after the answer, not before it", async () => {
    service.handle("/stores/ret_store_alert/policies", () => ({
      status: 200,
      body: storeSet("ret_store_alert", [{ ...policy("ret_store_alert"), currency: "euro" }]),
    }));
    const visit = returning("ret_store_alert");
    assert.deepEqual(await visit.answer(), {
      kind: "redirect",
      to: "/dashboard/settings/billing?billing=pending",
    });
    // policies_invalid: its Discord slot and webhook wait for `after`.
    assert.equal(visit.afterTasks.length, 1);
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.equal(state?.alerts?.policies_invalid, undefined);

    await Promise.all(visit.afterTasks.map((task) => task()));
    const [later] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.ok(later?.alerts?.policies_invalid, "the task claims the hourly Discord slot");
  });
});
