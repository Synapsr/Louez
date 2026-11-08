import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ApiEffect, ApiEffectSenders } from "./effects";

// The outbox on the database: a rollback leaves no row, a failed effect is
// retried and sent once, two dispatchers never both send a row.

const STORE = "fx_store_0000000001";

const effect: ApiEffect = {
  type: "reservation.platformNotification",
  payload: {
    kind: "confirmed",
    store: { id: STORE, name: "Store", slug: "store" },
    number: "2030-0001",
    totalAmount: "10.00",
    currency: "EUR",
  },
};

describe("api effects outbox (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let effects: typeof import("./effects");

  let sent: string[] = [];
  let failNext = 0;
  let gate: Promise<void> | null = null;

  const senders: ApiEffectSenders = {
    "reservation.platformNotification": async (payload) => {
      if (gate) await gate;
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("discord is down");
      }
      sent.push(payload.number);
    },
    "reservation.customerMessage": async () => {},
    "reservation.storeNotification": async () => {},
    "reservation.statusAnalytics": async () => {},
    "reservation.notesAnalytics": async () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_effects");
    louezDb = await import("@louez/db");
    effects = await import("./effects");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    sent = [];
    failNext = 0;
    gate = null;
    await louezDb.db.delete(louezDb.apiEffects);
  });

  const enqueue = () => louezDb.db.transaction((tx) => effects.enqueueEffects(tx, STORE, [effect]));

  test("a rolled back write leaves no row", async () => {
    await assert.rejects(
      louezDb.db.transaction(async (tx) => {
        await effects.enqueueEffects(tx, STORE, [effect]);
        throw new Error("the write failed");
      }),
      /the write failed/,
    );
    assert.equal((await louezDb.db.select().from(louezDb.apiEffects)).length, 0);
  });

  test("a failed effect is retried once due, and sent once", async () => {
    const ids = await enqueue();
    failNext = 1;
    const now = new Date();
    assert.deepEqual(await effects.dispatchEffects(ids, senders, () => now), {
      sent: 0,
      failed: 1,
      skipped: 0,
    });
    const [failed] = await effects.readEffects(ids);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.lastError, "discord is down");

    // Not due yet: the cron leaves it.
    await effects.retryDueEffects(senders, { now: new Date(now.getTime() + 1_000) });
    assert.deepEqual(sent, []);

    const later = new Date(now.getTime() + effects.effectRetryDelayMs(1) + 1_000);
    await effects.retryDueEffects(senders, { now: later });
    await effects.retryDueEffects(senders, { now: new Date(later.getTime() + 3_600_000) });
    assert.deepEqual(sent, ["2030-0001"], "sent once");
    const [done] = await effects.readEffects(ids);
    assert.equal(done?.status, "sent");
    assert.equal(done?.attempts, 2);
  });

  test("two dispatchers at once send a row once", async () => {
    const ids = await enqueue();
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = effects.dispatchEffects(ids, senders);
    // The first holds the claim while it sends: the second skips the row.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await effects.dispatchEffects(ids, senders);
    release();
    assert.deepEqual(second, { sent: 0, failed: 0, skipped: 1 });
    assert.deepEqual(await first, { sent: 1, failed: 0, skipped: 0 });
    assert.deepEqual(sent, ["2030-0001"]);

    // A sent row never runs again.
    assert.deepEqual(await effects.dispatchEffects(ids, senders), {
      sent: 0,
      failed: 0,
      skipped: 1,
    });
  });

  test("a row whose sender died is taken over once its claim expires", async () => {
    const ids = await enqueue();
    const now = new Date();
    assert.ok(await effects.claimEffect(ids[0] ?? "", now), "a sender takes it, then dies");
    await effects.retryDueEffects(senders, { now: new Date(now.getTime() + 1_000) });
    assert.deepEqual(sent, [], "its claim still holds");
    await effects.retryDueEffects(senders, {
      now: new Date(now.getTime() + effects.EFFECT_LEASE_MS + 1_000),
    });
    assert.deepEqual(sent, ["2030-0001"]);
  });

  test("the cron sends what the first dispatch never took, and gives up after the last attempt", async () => {
    const ids = await enqueue();
    // Too fresh: the first dispatch may still be on its way.
    await effects.retryDueEffects(senders, { now: new Date() });
    assert.deepEqual(sent, []);

    failNext = effects.EFFECT_MAX_ATTEMPTS;
    let now = new Date(Date.now() + effects.EFFECT_PENDING_GRACE_MS + 1_000);
    for (let attempt = 1; attempt <= effects.EFFECT_MAX_ATTEMPTS; attempt += 1) {
      await effects.retryDueEffects(senders, { now });
      now = new Date(now.getTime() + effects.effectRetryDelayMs(attempt) + 1_000);
    }
    const [row] = await effects.readEffects(ids);
    assert.equal(row?.status, "abandoned");
    assert.equal(row?.attempts, effects.EFFECT_MAX_ATTEMPTS);
    await effects.retryDueEffects(senders, { now: new Date(now.getTime() + 86_400_000) });
    assert.deepEqual(sent, []);
  });
});
