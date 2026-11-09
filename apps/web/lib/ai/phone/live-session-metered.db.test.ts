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

// A phone call's metered turns on the database (live-session.db.test.ts covers
// the flat tariff's settlement). The call's sync transaction reads rows (the
// call's session, the turn's debit already recorded) before it takes the
// store's credits lock; a debit committed while it waits for it must count
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

// The credit layer on, one included credit a month on the Pro plan, and turns
// metered in USD: a million input tokens cost $1, which is one credit.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";
process.env.AI_CREDITS_ENABLED = "true";
process.env.AI_CREDIT_MONTHLY_INCLUDED = JSON.stringify({ pro: 1 });
process.env.AI_CREDIT_COST_BASIS_USD = "1";
process.env.AI_PHONE_INPUT_USD_PER_MTOK = "1";
delete process.env.AI_PHONE_CREDITS_PER_MINUTE;

const USER = "user_phone_metered";
const STORE = "store_phone_metered";
const CONVERSATION = "conv_phone_metered_01";
const CREDIT = 1_000_000;

describe("phone call metered turns (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let liveSession: typeof import("./live-session");

  before(async () => {
    database = await createTestDatabase("phone_metered");
    louezDb = await import("@louez/db");
    liveSession = await import("./live-session");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "metered@phone.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: USER, name: "Phone", slug: "phone-metered" });
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
      providerCallId: "call_phone_metered",
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

  test("a turn metered while another debit spends the month's included credit pays it from prepaid", async () => {
    await raceOnOpenTransaction(
      database,
      async (holder) => {
        // Another debit holds the credits' lock and spends the month's one credit.
        await holder.query("SELECT store_id FROM ai_credits WHERE store_id = ? FOR UPDATE", [
          STORE,
        ]);
        await holder.query(
          "INSERT INTO ai_credit_debits (id, store_id, kind, dedup_key, debited_micro, from_monthly_micro, from_prepaid_micro) VALUES (?, ?, 'usage', ?, ?, ?, 0)",
          ["debit_phone_hold_0002", STORE, "holder:metered", CREDIT, CREDIT],
        );
      },
      [
        () =>
          liveSession.syncLiveSession(
            {
              type: "sync",
              conversationId: CONVERSATION,
              callId: "call_phone_metered",
              streamId: "stream_phone_metered",
              connectionId: "00000000-0000-4000-8000-000000000001",
              transcripts: [],
              responses: [
                {
                  id: "turn_phone_metered_1",
                  usage: { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 },
                },
              ],
              seconds: 30,
            },
            STORE,
          ),
      ],
    );

    const [row] = await louezDb.db
      .select({
        debited: louezDb.aiCreditDebits.debitedMicro,
        fromMonthly: louezDb.aiCreditDebits.fromMonthlyMicro,
        fromPrepaid: louezDb.aiCreditDebits.fromPrepaidMicro,
      })
      .from(louezDb.aiCreditDebits)
      .where(eq(louezDb.aiCreditDebits.dedupKey, "call:turn:turn_phone_metered_1"));
    assert.deepEqual(row, { debited: CREDIT, fromMonthly: 0, fromPrepaid: CREDIT });
  });
});
