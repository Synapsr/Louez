import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";

import {
  createTestDatabase,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The image debit on the database: its split between the month's included
// credits and the prepaid balance, and its locks against the other debits of
// the ledger. An AI photo job debits inside a transaction that read other rows
// first (the store's plan); it runs READ COMMITTED (CREDIT_DEBIT_TRANSACTION),
// as the dashboard's own debit does.

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

const USER = "user_image_credits";
const STORE = "store_image_credits";
/** Two stores whose ledgers are empty this month. */
const STORE_A = "store_image_cred_a";
const STORE_B = "store_image_cred_b";
/** A store whose phone calls write cost-only rows meanwhile. */
const STORE_PHONE = "store_image_cred_ph";
const CREDIT = 1_000_000;

describe("image credit debit (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let credits: typeof import("./credits");
  let advisorCredits: typeof import("@/lib/ai/advisor/credits");
  let plans: typeof import("@/lib/plans");

  before(async () => {
    database = await createTestDatabase("image_credits");
    louezDb = await import("@louez/db");
    credits = await import("./credits");
    advisorCredits = await import("@/lib/ai/advisor/credits");
    plans = await import("@/lib/plans");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "credits@image.test" });
    for (const [id, slug] of [
      [STORE, "image-credits"],
      [STORE_A, "image-credits-a"],
      [STORE_B, "image-credits-b"],
      [STORE_PHONE, "image-credits-phone"],
    ] as const) {
      await louezDb.db.insert(louezDb.stores).values({ id, userId: USER, name: "Credits", slug });
      await louezDb.db.insert(louezDb.aiCredits).values({ storeId: id, balanceMicro: 10 * CREDIT });
    }
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** A plan with 2 included credits a month: the debit sums what the month already used. */
  const withIncludedCredits = () => {
    const base = plans.getDefaultPlan();
    return { ...base, features: { ...base.features, aiCreditsPerMonth: 2 } };
  };

  test("a debit that waited for the credits' lock never spends the month's included credits twice", async () => {
    // Two included credits a month: one debit of 2 spends them all.
    const plan = withIncludedCredits();

    const [waiting] = await raceOnOpenTransaction(
      database,
      async (holder) => {
        // Another debit holds the credits' lock and spends the month's 2 credits.
        await holder.query("SELECT store_id FROM ai_credits WHERE store_id = ? FOR UPDATE", [
          STORE,
        ]);
        await holder.query(
          "INSERT INTO ai_credit_debits (id, store_id, kind, dedup_key, debited_micro, from_monthly_micro, from_prepaid_micro) VALUES (?, ?, 'usage', ?, ?, ?, 0)",
          ["debit_holder_00000001", STORE, "holder:1", 2 * CREDIT, 2 * CREDIT],
        );
      },
      [
        () =>
          louezDb.db.transaction(async (tx) => {
            // As a job does: a plain read first, which under REPEATABLE READ
            // would fix the snapshot the month's sum reads.
            await tx.select({ id: louezDb.stores.id }).from(louezDb.stores);
            return credits.recordImageEnhanceDebit(
              STORE,
              {
                dedupKey: "imgenh:race",
                imageKey: `${STORE}/products/race-ai.webp`,
                plan,
                costMicroUsd: 0,
                billMicro: 2 * CREDIT,
              },
              tx,
            );
          }, advisorCredits.CREDIT_DEBIT_TRANSACTION),
      ],
    );
    assert.equal(waiting, 2 * CREDIT);

    const [row] = await louezDb.db
      .select({
        fromMonthly: louezDb.aiCreditDebits.fromMonthlyMicro,
        fromPrepaid: louezDb.aiCreditDebits.fromPrepaidMicro,
      })
      .from(louezDb.aiCreditDebits)
      .where(eq(louezDb.aiCreditDebits.dedupKey, "imgenh:race"));
    assert.deepEqual(row, { fromMonthly: 0, fromPrepaid: 2 * CREDIT });
    const [balance] = await louezDb.db
      .select({ balanceMicro: louezDb.aiCredits.balanceMicro })
      .from(louezDb.aiCredits)
      .where(eq(louezDb.aiCredits.storeId, STORE));
    assert.equal(balance?.balanceMicro, 8 * CREDIT);
  });

  const imageDebit = (storeId: string, dedupKey: string) =>
    credits.recordImageEnhanceDebit(storeId, {
      dedupKey,
      imageKey: `${storeId}/products/${dedupKey}-ai.webp`,
      plan: withIncludedCredits(),
      costMicroUsd: 0,
      billMicro: CREDIT,
    });

  const insertDebit = (
    connection: Awaited<ReturnType<TestDatabase["connect"]>>,
    row: { id: string; storeId: string; dedupKey: string; createdAt?: string },
  ) =>
    connection.query(
      "INSERT INTO ai_credit_debits (id, store_id, kind, dedup_key, debited_micro, from_monthly_micro, from_prepaid_micro, created_at) VALUES (?, ?, 'usage', ?, 0, 0, 0, COALESCE(?, NOW()))",
      [row.id, row.storeId, row.dedupKey, row.createdAt ?? null],
    );

  /**
   * Runs `calls` while another transaction holds `hold`, and releases it once
   * every call is either done or waiting on a lock: a debit that never waits
   * runs straight through.
   */
  async function whileHeld<T>(
    hold: (connection: Awaited<ReturnType<TestDatabase["connect"]>>) => Promise<void>,
    calls: ReadonlyArray<() => Promise<T>>,
    release: (connection: Awaited<ReturnType<TestDatabase["connect"]>>) => Promise<void> = (
      connection,
    ) => connection.commit(),
  ) {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await hold(holder);
      let settled = 0;
      const running = calls.map((call) =>
        call().finally(() => {
          settled += 1;
        }),
      );
      const all = Promise.allSettled(running);
      const deadline = Date.now() + 2_000;
      for (;;) {
        const [rows] = await holder.query<Array<{ waiting: number } & RowDataPacket>>(
          "SELECT COUNT(DISTINCT ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_locks WHERE OBJECT_SCHEMA = ? AND LOCK_STATUS = 'WAITING'",
          [database.name],
        );
        if (settled + Number(rows[0]?.waiting) >= calls.length || Date.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await release(holder);
      return await all;
    } finally {
      await holder.end();
    }
  }

  test("two stores debiting at once over empty ledgers both go through", async () => {
    // The ledger row that bounds both stores' empty months is held, so a debit
    // that locked its sum's range would wait there, then both would insert
    // into the gap the other one locked.
    const outcomes = await whileHeld(
      async (holder) => {
        await holder.query("SELECT id FROM ai_credit_debits WHERE store_id = ? FOR UPDATE", [
          STORE,
        ]);
      },
      [() => imageDebit(STORE_A, "imgenh:store-a"), () => imageDebit(STORE_B, "imgenh:store-b")],
    );
    assert.deepEqual(
      outcomes.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : String(outcome.reason))),
      [CREDIT, CREDIT],
    );
  });

  test("an image debit and a phone call writing cost-only rows of the same store never deadlock", async () => {
    // The call's transaction writes cost-only rows without the credits' lock:
    // one before the image debit sums the month, one in the same second after.
    const second = "2026-11-09 12:00:00";
    const outcomes = await whileHeld(
      async (call) => {
        await insertDebit(call, {
          id: "debit_phone_cost_002",
          storeId: STORE_PHONE,
          dedupKey: "call:turn:1",
          createdAt: second,
        });
      },
      [() => imageDebit(STORE_PHONE, "imgenh:with-phone")],
      async (call) => {
        await insertDebit(call, {
          id: "debit_phone_cost_001",
          storeId: STORE_PHONE,
          dedupKey: "call:turn:2",
          createdAt: second,
        });
        await call.commit();
      },
    );
    assert.deepEqual(
      outcomes.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : String(outcome.reason))),
      [CREDIT],
    );
    const rows = await louezDb.db
      .select({ dedupKey: louezDb.aiCreditDebits.dedupKey })
      .from(louezDb.aiCreditDebits)
      .where(eq(louezDb.aiCreditDebits.storeId, STORE_PHONE));
    assert.deepEqual(rows.map((row) => row.dedupKey).sort(), [
      "call:turn:1",
      "call:turn:2",
      "imgenh:with-phone",
    ]);
  });
});
