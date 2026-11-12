import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { DepositAttemptResolution, DepositHoldsPort } from "../../platform/ports";
import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls } from "../../platform/test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@da.test` } } : null;
        },
      },
    },
  },
});

// The store's resolution of a deposit hold Stripe has not confirmed: the contract, the
// rights and the errors. What it does to the hold is the app's (apps/web
// lib/reservations/deposit-hold.db.test.ts); here the port is a fake that answers what
// it is told and records what it was asked.

const OWNER = "da_owner_user_000001";
const STORE = "da_store_a_000000001";
const RESERVATION = "da_reservation_000001";

describe("resolveDepositAttempt (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let apiKeys: typeof import("../../services/api-keys");
  let routers: { reservations: { resolveDepositAttempt: unknown } };

  const asked: Array<Parameters<DepositHoldsPort["resolveUnconfirmedAttempt"]>[0]> = [];
  let answer: DepositAttemptResolution = { ok: true, outcome: "closed", paymentIntentId: null };
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    depositHolds: {
      resolveUnconfirmedAttempt: async (input) => {
        asked.push(input);
        return answer;
      },
    } satisfies DepositHoldsPort,
  };

  before(async () => {
    database = await createTestDatabase("api_deposit_attempts");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    apiKeys = await import("../../services/api-keys");
    routers = {
      reservations: {
        resolveDepositAttempt: (await import("./deposit-attempts")).resolveDepositAttempt,
      },
    };
    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@da.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Deposit attempts",
      slug: "da-store",
      settings: { reservationMode: "payment", advanceNoticeMinutes: 0, currency: "EUR" },
      onboardingCompleted: true,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    asked.length = 0;
    answer = { ok: true, outcome: "closed", paymentIntentId: null };
  });

  const session = (): BaseContext => ({
    headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
    transport: "rpc",
    ports,
    receipt: {},
  });

  type Client = RouterClient<{
    reservations: {
      resolveDepositAttempt: typeof import("./deposit-attempts").resolveDepositAttempt;
    };
  }>;
  const client = (context: BaseContext) =>
    orpc.createRouterClient(routers as never, { context, path: ["dashboard"] }) as Client;

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data } = caught as { data?: { code?: string; i18nKey?: string } };
    assert.equal(data?.code, code, String(caught));
    return data;
  }

  test("a session resolves the store's attempt, as the signed-in user", async () => {
    const result = await client(session()).reservations.resolveDepositAttempt({
      reservationId: RESERVATION,
      resolution: { kind: "nothing_at_stripe" },
    });

    assert.deepEqual(result, {
      reservationId: RESERVATION,
      outcome: "closed",
      paymentIntentId: null,
    });
    assert.deepEqual(asked, [
      {
        reservationId: RESERVATION,
        storeId: STORE,
        actorUserId: OWNER,
        resolution: { kind: "nothing_at_stripe" },
      },
    ]);
  });

  test("no API key or agent may call it, whatever its rights", async () => {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Store agent",
      permissions: {
        reservations: "write",
        products: "none",
        customers: "none",
        categories: "none",
        payments: "write",
        analytics: "none",
        settings: "write",
        billing: "none",
      },
    });
    const agent: BaseContext = {
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "mcp",
      ports,
      receipt: {},
    };

    await rejects(
      client(agent).reservations.resolveDepositAttempt({
        reservationId: RESERVATION,
        resolution: { kind: "nothing_at_stripe" },
      }),
      "SESSION_ONLY",
    );
    assert.deepEqual(asked, []);
  });

  test("a PaymentIntent id that is not one is refused before anything is asked", async () => {
    await assert.rejects(
      client(session()).reservations.resolveDepositAttempt({
        reservationId: RESERVATION,
        resolution: { kind: "payment_intent", paymentIntentId: "ch_123" },
      }),
    );
    assert.deepEqual(asked, []);
  });

  test("each refusal is a stable error the dashboard translates", async () => {
    const cases: Array<[DepositAttemptResolution, string, string]> = [
      [
        { ok: false, error: "reservation_not_found" },
        "RESERVATION_NOT_FOUND",
        "errors.reservationNotFound",
      ],
      [
        { ok: false, error: "no_unconfirmed_attempt" },
        "DEPOSIT_ATTEMPT_NONE",
        "errors.depositAttempt.none",
      ],
      [
        { ok: false, error: "attempt_in_progress" },
        "DEPOSIT_ATTEMPT_IN_PROGRESS",
        "errors.stripe.authorizationInProgress",
      ],
      [
        { ok: false, error: "intent_not_found" },
        "PAYMENT_INTENT_NOT_FOUND",
        "errors.depositAttempt.intentNotFound",
      ],
      [
        { ok: false, error: "stripe_unavailable" },
        "STRIPE_UNAVAILABLE",
        "errors.depositAttempt.stripeUnavailable",
      ],
      [
        { ok: false, error: "found_at_stripe", paymentIntentId: "pi_found", outcome: "authorized" },
        "DEPOSIT_ATTEMPT_FOUND_AT_STRIPE",
        "errors.depositAttempt.foundAtStripe",
      ],
      [
        { ok: false, error: "intent_mismatch", mismatches: ["amount", "card"] },
        "PAYMENT_INTENT_MISMATCH",
        "errors.depositAttempt.intentMismatch",
      ],
    ];
    for (const [refusal, code, i18nKey] of cases) {
      answer = refusal;
      const data = await rejects(
        client(session()).reservations.resolveDepositAttempt({
          reservationId: RESERVATION,
          resolution: { kind: "payment_intent", paymentIntentId: "pi_named" },
        }),
        code,
      );
      assert.equal(data?.i18nKey, i18nKey, code);
    }
  });
});
