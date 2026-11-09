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

// The image debit's split between the month's included credits and the
// prepaid balance, on the database. An AI photo job debits inside a
// transaction that read other rows first (the store's plan), so its snapshot
// may predate a debit that commits while it waits for the credits' lock.

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
const CREDIT = 1_000_000;

describe("image credit debit (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let credits: typeof import("./credits");
  let plans: typeof import("@/lib/plans");

  before(async () => {
    database = await createTestDatabase("image_credits");
    louezDb = await import("@louez/db");
    credits = await import("./credits");
    plans = await import("@/lib/plans");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "credits@image.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: USER, name: "Credits", slug: "image-credits" });
    await louezDb.db.insert(louezDb.aiCredits).values({ storeId: STORE, balanceMicro: 10 * CREDIT });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("a debit that waited for the credits' lock never spends the month's included credits twice", async () => {
    const base = plans.getDefaultPlan();
    // Two included credits a month: one debit of 2 spends them all.
    const plan = { ...base, features: { ...base.features, aiCreditsPerMonth: 2 } };

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
            // As a job does: a plain read first fixes the transaction's snapshot.
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
          }),
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
});
