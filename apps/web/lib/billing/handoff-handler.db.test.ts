import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type { MemberRole } from "@louez/utils";

import type { BillingHandoffRequest } from "./handoff-handler";
import type { BillingHandoffAnswer } from "./handoff-page";
import { decodeTokenClaims, serviceRefusal } from "./handoff-verifier.fixtures";

// `GET /dashboard/billing?to=` (louez-billing docs/api, README §10 steps 1 and 2, §12)
// on a test database: who gets a token, as whom, and that the service would accept it.
// The policies use the public test values of fees.md (Q33): 250 bps, a 150
// marketplace fee.

const DASHBOARD = "https://app.billing.test";
const BILLING = "https://billing.billing.test";
const KID = "louez-sso-test-1";
const NEW_STORES_FROM = "2027-01-25T00:00:00Z";
const NOW = new Date("2027-02-10T09:00:00Z");

const pair = generateKeyPairSync("ed25519");
const ENV = {
  LOUEZ_BILLING: "cloud",
  BILLING_SERVICE_URL: BILLING,
  BILLING_OUTBOUND_KEYS: JSON.stringify({ "louez-req-a": "a".repeat(40) }),
  BILLING_OUTBOUND_ACTIVE_KID: "louez-req-a",
  BILLING_RESPONSE_KEYS: JSON.stringify({ "billing-res-a": "b".repeat(40) }),
  BILLING_NEW_STORES_FROM: NEW_STORES_FROM,
  BILLING_SSO_PRIVATE_KEY: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  BILLING_SSO_KID: KID,
  BILLING_GATE_DISABLED: undefined,
};

const policy = (storeId: string, invoicing: "service" | "louez_legacy") => ({
  schema: "louez.billing.policy/1",
  storeId,
  version: 1,
  effectiveFrom: "2026-12-01T00:00:00Z",
  issuedAt: "2026-11-20T10:00:00Z",
  newStoresCreatedFrom: null,
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
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Commission de test", en: "Test commission" }, notice: null },
});

describe("billing hand-off route (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let handler: typeof import("./handoff-handler");
  const saved = new Map(Object.keys(ENV).map((name) => [name, process.env[name]]));

  const setEnv = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  before(async () => {
    database = await createTestDatabase("billing_handoff");
    louezDb = await import("@louez/db");
    handler = await import("./handoff-handler");
    const store = (id: string, createdAt: string) => ({
      id,
      userId: `user_${id}`,
      name: id,
      slug: id.replaceAll("_", "-"),
      createdAt: new Date(createdAt),
    });
    await louezDb.db.insert(louezDb.stores).values([
      // Legacy: created before the cutoff, with and without a version of its own.
      store("hof_legacy", "2026-05-01T00:00:00Z"),
      store("hof_plain_old", "2026-06-01T00:00:00Z"),
      // Billed by the service: its own version, or new and not processed yet.
      store("hof_service", "2027-02-01T00:00:00Z"),
      store("hof_fresh", "2027-02-09T00:00:00Z"),
    ]);
    await louezDb.db.insert(louezDb.billingPolicies).values(
      [policy("hof_legacy", "louez_legacy"), policy("hof_service", "service")].map((body) => ({
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
  beforeEach(() => setEnv(ENV));
  afterEach(() => setEnv(Object.fromEntries(saved)));

  /** A visit of `/dashboard/billing?to=…` by `userId`, on `storeId` with `role`. */
  const visiting = (
    storeId: string,
    role: MemberRole,
    overrides: Partial<BillingHandoffRequest> & { admin?: boolean } = {},
  ) => {
    const calls: string[] = [];
    const { admin = false, ...rest } = overrides;
    const request: BillingHandoffRequest = {
      connection: async () => {
        calls.push("connection");
      },
      to: "/payment-method",
      getSession: async () => {
        calls.push("session");
        return { userId: "user_owner", email: "someone@example.test" };
      },
      getStore: async () => ({ id: storeId, role }),
      isPlatformAdmin: () => admin,
      getLocale: async () => "fr",
      dashboardOrigin: `${DASHBOARD}/`,
      now: () => NOW,
      ...rest,
    };
    return { calls, answer: () => handler.answerBillingHandoff(request) };
  };

  /** The token of a page answer, as the service reads it. */
  function tokenOf(answer: BillingHandoffAnswer) {
    assert.equal(answer.kind, "page");
    if (answer.kind !== "page") throw new Error("not a page");
    assert.equal(answer.billingOrigin, BILLING);
    assert.equal(answer.backHref, "/dashboard/settings/billing");
    const refusal = serviceRefusal(answer.token, {
      keys: new Map([[KID, pair.publicKey]]),
      dashboardOrigin: DASHBOARD,
      billingOrigin: BILLING,
      nowSeconds: Math.floor(NOW.getTime() / 1000) + 5,
    });
    assert.equal(refusal, null);
    return decodeTokenClaims(answer.token);
  }

  test("outside service mode the route answers 404 and reads no session", async () => {
    for (const env of [
      { LOUEZ_BILLING: undefined },
      { LOUEZ_BILLING: "off" },
      { LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: undefined },
    ]) {
      setEnv(env);
      const visit = visiting("hof_service", "owner");
      assert.deepEqual(await visit.answer(), { kind: "not_found" });
      assert.deepEqual(visit.calls, ["connection"]);
      setEnv(ENV);
    }
  });

  test("a visitor signs in first and comes back to the same page", async () => {
    const visit = visiting("hof_service", "owner", { getSession: async () => null });
    const answer = await visit.answer();
    assert.equal(answer.kind, "redirect");
    if (answer.kind !== "redirect") return;
    const callback = new URL(answer.to, DASHBOARD).searchParams.get("callbackUrl");
    assert.equal(callback, "/dashboard/billing?to=%2Fpayment-method");
  });

  test("a user without a store goes to the onboarding", async () => {
    const visit = visiting("hof_service", "owner", { getStore: async () => null });
    assert.deepEqual(await visit.answer(), { kind: "redirect", to: "/onboarding" });
  });

  test("the owner of a store the service bills gets an owner token for that store", async () => {
    const claims = tokenOf(await visiting("hof_service", "owner").answer());
    assert.deepEqual(
      { ...claims, jti: "", iat: 0, exp: 0 },
      {
        iss: DASHBOARD,
        aud: BILLING,
        sub: "user_owner",
        store_id: "hof_service",
        role: "owner",
        locale: "fr",
        to: "/payment-method",
        return_url: `${DASHBOARD}/dashboard/billing/return`,
        jti: "",
        iat: 0,
        exp: 0,
      },
    );
  });

  test("a new store the service has not processed yet fails closed: its owner adds a card", async () => {
    const claims = tokenOf(await visiting("hof_fresh", "owner").answer());
    assert.equal(claims.store_id, "hof_fresh");
    assert.equal(claims.role, "owner");
  });

  test("the owner of a legacy store, or a member, gets no token (D4)", async () => {
    for (const [storeId, role] of [
      ["hof_legacy", "owner"],
      ["hof_plain_old", "owner"],
      ["hof_service", "member"],
    ] as const) {
      const answer = await visiting(storeId, role).answer();
      assert.deepEqual(
        answer,
        { kind: "redirect", to: "/dashboard/settings" },
        `${storeId} ${role}`,
      );
    }
  });

  test("a platform admin gets a read-only token on any store, legacy included", async () => {
    for (const [storeId, role] of [
      ["hof_legacy", "platform_admin"],
      ["hof_plain_old", "member"],
      ["hof_service", "platform_admin"],
    ] as const) {
      const claims = tokenOf(await visiting(storeId, role, { admin: true }).answer());
      assert.equal(claims.role, "platform_admin", storeId);
      assert.equal(claims.store_id, storeId);
      assert.equal(claims.sub, "user_owner");
    }
  });

  test("a page outside the contract opens the overview", async () => {
    for (const to of [null, "/admin", "https://evil.test/sso"]) {
      const claims = tokenOf(await visiting("hof_service", "owner", { to }).answer());
      assert.equal(claims.to, "/", String(to));
    }
  });

  test("without its signing key the hand-off is unavailable, and no token is minted", async () => {
    setEnv({ BILLING_SSO_PRIVATE_KEY: undefined });
    assert.deepEqual(await visiting("hof_service", "owner").answer(), {
      kind: "unavailable",
      backHref: "/dashboard/settings/billing",
    });
  });
});
