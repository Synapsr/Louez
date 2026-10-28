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
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  /** An owner of `storeId` coming back; `after` keeps its tasks, as Next.js runs them later. */
  const returning = (storeId: string, overrides: Partial<BillingReturnRequest> = {}) => {
    const calls: string[] = [];
    const afterTasks: Array<() => Promise<void>> = [];
    const request: BillingReturnRequest = {
      connection: async () => {
        calls.push("connection");
      },
      after: (task) => {
        afterTasks.push(task);
      },
      getUserId: async () => {
        calls.push("user");
        return "user_owner";
      },
      getStore: async () => ({ id: storeId, role: "owner" }),
      ...overrides,
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
    const visit = returning("ret_store_anon", { getUserId: async () => null });
    assert.deepEqual(await visit.answer(), {
      kind: "redirect",
      to: "/login?callbackUrl=%2Fdashboard%2Fbilling%2Freturn",
    });
  });

  test("a user without a store goes to the onboarding", async () => {
    const visit = returning("ret_store_none", { getStore: async () => null });
    assert.deepEqual(await visit.answer(), { kind: "redirect", to: "/onboarding" });
  });

  test("a member goes to the settings without a toast, and nothing is pulled", async () => {
    service.handle("/stores/ret_store_member/policies", () => ({
      status: 200,
      body: storeSet("ret_store_member", [policy("ret_store_member")]),
    }));
    const visit = returning("ret_store_member", {
      getStore: async () => ({ id: "ret_store_member", role: "member" }),
    });
    assert.deepEqual(await visit.answer(), { kind: "redirect", to: "/dashboard/settings" });
    assert.deepEqual(requestsFor("ret_store_member"), []);
  });

  test("an owner's or a platform admin's return pulls the store and says billing is up to date", async () => {
    const visitors: ReadonlyArray<{ readonly storeId: string; readonly role: MemberRole }> = [
      { storeId: "ret_store_owner", role: "owner" },
      { storeId: "ret_store_admin", role: "platform_admin" },
    ];
    for (const { storeId, role } of visitors) {
      service.handle(`/stores/${storeId}/policies`, () => ({
        status: 200,
        body: storeSet(storeId, [policy(storeId)]),
      }));
      const visit = returning(storeId, { getStore: async () => ({ id: storeId, role }) });
      assert.deepEqual(await visit.answer(), {
        kind: "redirect",
        to: "/dashboard/settings?billing=refreshed",
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
        { kind: "redirect", to: "/dashboard/settings?billing=pending" },
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
      to: "/dashboard/settings?billing=pending",
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
