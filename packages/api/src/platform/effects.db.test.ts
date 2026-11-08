import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ApiEffect, ApiEffectSenders, EffectSendContext } from "./effects";

// The outbox on the database: a rollback leaves no row; a failure is retried
// and sent once; a sender whose claim was taken over changes nothing and
// sends nothing; a sender that times out keeps its row blocked until its
// lease ends; rows of one key go out in order; newer news supersedes; a row
// whose store or reservation is gone is cancelled; done rows are pruned.

const STORE = "fx_store_0000000001";
const RESERVATION = "fx_reservation_00001";

const platform = (number: string, orderingKey?: string): ApiEffect => ({
  type: "reservation.platformNotification",
  orderingKey,
  reservationId: RESERVATION,
  payload: {
    channel: "discord",
    kind: "confirmed",
    store: { id: STORE, name: "Store", slug: "store" },
    number,
    totalAmount: "10.00",
    currency: "EUR",
  },
});

describe("api effects outbox (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let effects: typeof import("./effects");

  let sent: string[] = [];
  let failNext = 0;
  let gate: Promise<void> | null = null;
  let checkClaim = true;

  const senders: ApiEffectSenders = {
    "reservation.platformNotification": async (payload, context: EffectSendContext) => {
      if (gate) await gate;
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("discord is down");
      }
      if (checkClaim) await context.assertClaim();
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
    await louezDb.db.insert(louezDb.users).values({ id: "fx_owner", email: "fx@fx.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "fx_owner", name: "Store", slug: "fx-store" });
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id: RESERVATION,
      storeId: STORE,
      customerId: "fx_customer",
      number: "2030-0001",
      status: "confirmed",
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    sent = [];
    failNext = 0;
    gate = null;
    checkClaim = true;
    await louezDb.db.delete(louezDb.apiEffects);
  });

  const enqueue = (...list: ApiEffect[]) =>
    louezDb.db.transaction((tx) => effects.enqueueEffects(tx, STORE, list));
  const statusOf = async (id: string) => (await effects.readEffects([id]))[0]?.status;

  test("a rolled back write leaves no row", async () => {
    await assert.rejects(
      louezDb.db.transaction(async (tx) => {
        await effects.enqueueEffects(tx, STORE, [platform("A")]);
        throw new Error("the write failed");
      }),
      /the write failed/,
    );
    assert.equal((await louezDb.db.select().from(louezDb.apiEffects)).length, 0);
  });

  test("a failed effect is retried once due, and sent once", async () => {
    const ids = await enqueue(platform("A"));
    failNext = 1;
    const start = new Date();
    assert.deepEqual(await effects.dispatchEffects(ids, senders, { now: () => start }), {
      sent: 0,
      failed: 1,
      skipped: 0,
    });
    const [failed] = await effects.readEffects(ids);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.lastError, "discord is down");
    assert.equal(failed?.claimToken, null);

    await effects.retryDueEffects(senders, { now: () => new Date(start.getTime() + 1_000) });
    assert.deepEqual(sent, [], "not due yet");
    const due = new Date(start.getTime() + effects.effectRetryDelayMs(1) + 1_000);
    await effects.retryDueEffects(senders, { now: () => due });
    await effects.retryDueEffects(senders, { now: () => new Date(due.getTime() + 3_600_000) });
    assert.deepEqual(sent, ["A"], "sent once");
    assert.equal(await statusOf(ids[0] ?? ""), "sent");
  });

  test("a sender whose claim was taken over sends nothing and records nothing", async () => {
    const [id = ""] = await enqueue(platform("A"));
    const start = new Date();
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // A claims and stalls before it sends.
    const a = effects.dispatchEffects([id], senders, { now: () => start, sendTimeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // B finds A's claim expired, takes the row over and sends it.
    gate = null;
    const later = new Date(start.getTime() + effects.EFFECT_LEASE_MS + 1_000);
    const b = await effects.dispatchEffects([id], senders, { now: () => later });
    assert.deepEqual(b, { sent: 1, failed: 0, skipped: 0 });

    // A wakes up: its claim no longer holds, so it neither sends nor records.
    release();
    assert.deepEqual(await a, { sent: 0, failed: 1, skipped: 0 });
    const [row] = await effects.readEffects([id]);
    assert.equal(row?.status, "sent", "B's outcome stands");
    assert.equal(row?.attempts, 2);

    // C, the cron, finds nothing to do.
    await effects.retryDueEffects(senders, {
      now: () => new Date(later.getTime() + effects.EFFECT_LEASE_MS * 2),
    });
    assert.deepEqual(sent, ["A"], "exactly one send");
  });

  test("a sender that times out keeps its row, and its key, blocked until the lease ends", async () => {
    const key = "reservation:r:customer:email";
    const [first = "", later = ""] = await enqueue(
      platform("confirmed", key),
      platform("cancelled", key),
    );
    // A sender that ignores its signal and checks nothing: it stalls, then delivers.
    let deliver = () => {};
    const stall = new Promise<void>((resolve) => {
      deliver = resolve;
    });
    const deaf: ApiEffectSenders = {
      ...senders,
      "reservation.platformNotification": async (payload) => {
        await stall;
        sent.push(payload.number);
      },
    };
    const start = new Date();
    const stalled = effects.dispatchEffects([first], deaf, { now: () => start, sendTimeoutMs: 50 });
    assert.deepEqual(await stalled, { sent: 0, failed: 1, skipped: 0 });
    const [uncertain] = await effects.readEffects([first]);
    assert.equal(uncertain?.status, "running", "its outcome is unknown: it stays claimed");
    assert.equal(uncertain?.claimToken, null, "its late sender can no longer record");
    assert.match(uncertain?.lastError ?? "", /Outcome unknown/);

    // Before the lease ends, nothing of the key runs: not the retry, not the later row.
    const beforeLease = new Date(start.getTime() + effects.EFFECT_LEASE_MS - 1_000);
    await effects.retryDueEffects(senders, { now: () => beforeLease });
    await effects.dispatchEffects([later], senders, { now: () => beforeLease });
    assert.deepEqual(sent, []);
    assert.equal(await statusOf(later), "pending");

    // The stalled sender delivers late; then the lease ends and the retry runs, then the later row.
    deliver();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterLease = new Date(start.getTime() + effects.EFFECT_LEASE_MS + 1_000);
    await effects.retryDueEffects(senders, { now: () => afterLease });
    assert.deepEqual(sent, ["confirmed", "confirmed", "cancelled"], "at least once, and in order");
    assert.equal(await statusOf(first), "sent");
    assert.equal(await statusOf(later), "sent");
  });

  test("the signal reaches the sender at its timeout", async () => {
    const [id = ""] = await enqueue(platform("A"));
    let aborted = false;
    const listening: ApiEffectSenders = {
      ...senders,
      "reservation.platformNotification": (_payload, context) =>
        new Promise((resolve) => {
          context.signal.addEventListener("abort", () => {
            aborted = true;
            resolve(undefined);
          });
        }),
    };
    await effects.dispatchEffects([id], listening, { sendTimeoutMs: 50 });
    assert.equal(aborted, true);
  });

  test("an expired claim past the last attempt is abandoned, not run again", async () => {
    const [id = ""] = await enqueue(platform("A"));
    await louezDb.db.update(louezDb.apiEffects).set({
      status: "running",
      attempts: effects.EFFECT_MAX_ATTEMPTS,
      lockedUntil: new Date(Date.now() - 1_000),
      claimToken: "dead",
    });
    await effects.retryDueEffects(senders);
    assert.equal(await statusOf(id), "abandoned");
    assert.deepEqual(sent, []);
  });

  test("rows of one key go out in order: a later one waits for an earlier one in retry", async () => {
    const [first = "", second = ""] = await enqueue(
      platform("confirmed", "reservation:r:platform:discord"),
      platform("cancelled", "reservation:r:platform:discord"),
    );
    failNext = 1;
    const start = new Date();
    await effects.dispatchEffects([first, second], senders, { now: () => start });
    assert.equal(await statusOf(first), "failed");
    assert.equal(await statusOf(second), "pending", "it waits for the first");

    const due = new Date(
      start.getTime() + effects.effectRetryDelayMs(1) + effects.EFFECT_PENDING_GRACE_MS,
    );
    await effects.retryDueEffects(senders, { now: () => due });
    assert.deepEqual(sent, ["confirmed", "cancelled"], "in the order they were added");
  });

  test("newer news supersedes the unsent rows of its key prefix and kind only", async () => {
    const [old = "", other = ""] = await enqueue(
      platform("old", "reservation:r:customer:email"),
      platform("other kind", "reservation:r:customer:email"),
    );
    await louezDb.db
      .update(louezDb.apiEffects)
      .set({ payload: { notification: "customer_request_accepted", number: "old" } })
      .where(eq(louezDb.apiEffects.id, old));
    await louezDb.db.transaction(async (tx) => {
      await effects.supersedeEffects(tx, STORE, "reservation:r:customer:", {
        field: "notification",
        values: ["customer_request_accepted"],
      });
      await effects.enqueueEffects(tx, STORE, [platform("new", "reservation:r:customer:email")]);
    });
    const [row] = await effects.readEffects([old]);
    assert.equal(row?.status, "superseded");
    assert.deepEqual(row?.payload, {}, "its personal data is gone");
    assert.equal(await statusOf(other), "pending", "a row of another kind stays");
    await effects.retryDueEffects(senders, {
      now: () => new Date(Date.now() + effects.EFFECT_PENDING_GRACE_MS + 1_000),
    });
    assert.deepEqual(sent, ["other kind", "new"]);
  });

  test("a row whose reservation is gone is cancelled, never sent", async () => {
    const [id = ""] = await louezDb.db.transaction((tx) =>
      effects.enqueueEffects(tx, STORE, [
        { ...platform("A"), reservationId: "fx_gone_000000000000" },
      ]),
    );
    await effects.dispatchEffects([id], senders);
    const [row] = await effects.readEffects([id]);
    assert.equal(row?.status, "cancelled");
    assert.deepEqual(row?.payload, {});
    assert.deepEqual(sent, []);
  });

  test("done rows are deleted after the retention, the others kept", async () => {
    const [done = "", waiting = ""] = await enqueue(platform("A"), platform("B"));
    await effects.dispatchEffects([done], senders);
    const later = new Date(Date.now() + effects.EFFECT_RETENTION_MS + 60_000);
    assert.equal(await effects.pruneEffects(later), 1);
    assert.deepEqual(
      (await effects.readEffects([done, waiting])).map((row) => row.id),
      [waiting],
    );
  });
});
