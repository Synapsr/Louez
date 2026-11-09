import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// A phone call's credits on the database. The call's transactions read rows
// (the call's session, the debit already recorded) before they take the
// store's credits lock; a debit committed while they wait for it must count
// against the month's included credits.

// The credit modules import "server-only", which throws outside Next.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

// The credit layer on, one included credit a month on the Pro plan, and the
// flat tariff: a started minute of call costs one credit.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";
process.env.AI_CREDITS_ENABLED = "true";
process.env.AI_CREDIT_MONTHLY_INCLUDED = JSON.stringify({ pro: 1 });
process.env.AI_PHONE_CREDITS_PER_MINUTE = "1";

const USER = "user_phone_credits";
const STORE = "store_phone_credits";
const CONVERSATION = "conv_phone_credits_01";
const CREDIT = 1_000_000;

describe("phone call credits (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let liveSession: typeof import("./live-session");

  before(async () => {
    database = await createTestDatabase("phone_credits");
    louezDb = await import("@louez/db");
    liveSession = await import("./live-session");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "credits@phone.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: USER, name: "Phone", slug: "phone-credits" });
    await louezDb.db.insert(louezDb.subscriptions).values({
      storeId: STORE,
      planSlug: "pro",
      billingMode: "subscription",
      status: "active",
    });
    await louezDb.db.insert(louezDb.aiCredits).values({ storeId: STORE, balanceMicro: 10 * CREDIT });
    await louezDb.db
      .insert(louezDb.aiAdvisorConversations)
      .values({ id: CONVERSATION, storeId: STORE });
    await louezDb.db.insert(louezDb.voiceSessionsTable).values({
      conversationId: CONVERSATION,
      storeId: STORE,
      providerCallId: "call_phone_credits",
      status: "active",
      liveModel: "live",
      backendModel: "backend",
      voice: "voice",
      maxSeconds: 600,
      startedAt: new Date(),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("a call settled while another debit spends the month's included credit pays it from prepaid", async () => {
    await raceOnOpenTransaction(
      database,
      async (holder) => {
        // Another debit holds the credits' lock and spends the month's one credit.
        await holder.query("SELECT store_id FROM ai_credits WHERE store_id = ? FOR UPDATE", [
          STORE,
        ]);
        await holder.query(
          "INSERT INTO ai_credit_debits (id, store_id, kind, dedup_key, debited_micro, from_monthly_micro, from_prepaid_micro) VALUES (?, ?, 'usage', ?, ?, ?, 0)",
          ["debit_phone_hold_0001", STORE, "holder:phone", CREDIT, CREDIT],
        );
      },
      [
        () =>
          liveSession.finishLiveSession({
            conversationId: CONVERSATION,
            storeId: STORE,
            seconds: 60,
            finalized: true,
            sessionId: null,
            outcome: "end",
          }),
      ],
    );

    const [row] = await louezDb.db
      .select({
        debited: louezDb.aiCreditDebits.debitedMicro,
        fromMonthly: louezDb.aiCreditDebits.fromMonthlyMicro,
        fromPrepaid: louezDb.aiCreditDebits.fromPrepaidMicro,
      })
      .from(louezDb.aiCreditDebits)
      .where(eq(louezDb.aiCreditDebits.dedupKey, "call:audio:call_phone_credits"));
    assert.deepEqual(row, { debited: CREDIT, fromMonthly: 0, fromPrepaid: CREDIT });
    const [balance] = await louezDb.db
      .select({ balanceMicro: louezDb.aiCredits.balanceMicro })
      .from(louezDb.aiCredits)
      .where(eq(louezDb.aiCredits.storeId, STORE));
    assert.equal(balance?.balanceMicro, 9 * CREDIT);
  });
});
