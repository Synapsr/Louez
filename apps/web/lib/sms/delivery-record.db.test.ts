import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The records of an SMS the provider accepted, on the database: its
// acceptance (the log row, and the outbox row that takes a prepaid credit),
// written once per id, and its credit, taken once however often it is tried,
// with two SMS of one store taking theirs at once.

const USER = "user_sms_record";
const STORE = "store_sms_record_01";

describe("SMS delivery records (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let records: typeof import("./delivery-record");
  let smsEffects: typeof import("./sms-effects");
  let planLimits: typeof import("@/lib/plan-limits");
  let sequence = 0;

  before(async () => {
    database = await createTestDatabase("sms_delivery_record");
    louezDb = await import("@louez/db");
    records = await import("./delivery-record");
    smsEffects = await import("./sms-effects");
    planLimits = await import("@/lib/plan-limits");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "sms@record.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: USER, name: "Kayaks", slug: "sms-record" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const setBalance = async (balance: number) => {
    await louezDb.db.delete(louezDb.smsCredits);
    await louezDb.db
      .insert(louezDb.smsCredits)
      .values({ storeId: STORE, balance, totalPurchased: balance });
  };

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.smsLogs);
    await louezDb.db.delete(louezDb.apiEffects);
    await setBalance(5);
  });

  type Acceptance = import("./delivery-record").SmsAcceptance;
  const acceptance = (overrides: Partial<Acceptance> = {}): Acceptance => {
    sequence += 1;
    return {
      id: `smsrec_${String(sequence).padStart(14, "0")}`,
      storeId: STORE,
      reservationId: null,
      customerId: null,
      to: "+33612345678",
      message: "Kayaks\nReservation #2030-0001 cancelled.",
      templateType: "reservation_cancelled",
      messageId: `provider_${sequence}`,
      creditSource: "topup",
      ...overrides,
    };
  };

  const credits = async () => {
    const [row] = await louezDb.db
      .select({ balance: louezDb.smsCredits.balance, totalUsed: louezDb.smsCredits.totalUsed })
      .from(louezDb.smsCredits)
      .where(eq(louezDb.smsCredits.storeId, STORE));
    return row;
  };
  const logs = () =>
    louezDb.db
      .select({
        id: louezDb.smsLogs.id,
        status: louezDb.smsLogs.status,
        messageId: louezDb.smsLogs.messageId,
        creditSource: louezDb.smsLogs.creditSource,
      })
      .from(louezDb.smsLogs)
      .orderBy(louezDb.smsLogs.id);
  const debitRows = () =>
    louezDb.db
      .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects);

  const context = {
    effectId: "effect_debit",
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {},
  };

  test("a prepaid SMS's acceptance writes its log row and its credit's outbox row, once", async () => {
    const sms = acceptance();
    assert.equal(await records.isSmsAccepted(sms.id), false);
    const debits = await records.recordSmsAcceptance(sms);
    assert.equal(debits.length, 1);
    // Written again, by a later run of the same outbox row: nothing more.
    assert.deepEqual(await records.recordSmsAcceptance(sms), []);

    assert.equal(await records.isSmsAccepted(sms.id), true);
    assert.deepEqual(await logs(), [
      { id: sms.id, status: "sent", messageId: sms.messageId, creditSource: "topup_pending" },
    ]);
    assert.deepEqual(await debitRows(), [
      { type: "sms.prepaidDebit", payload: { recordId: sms.id, storeId: STORE } },
    ]);
    assert.deepEqual(await credits(), { balance: 5, totalUsed: 0 }, "not taken yet");
  });

  test("its credit is taken once, however often and at once it is tried", async () => {
    const sms = acceptance();
    await records.recordSmsAcceptance(sms);
    const senders = smsEffects.createSmsEffectSenders();
    const payload = { recordId: sms.id, storeId: STORE };
    await senders["sms.prepaidDebit"](payload, context);
    await senders["sms.prepaidDebit"](payload, context);
    await Promise.all([
      senders["sms.prepaidDebit"](payload, context),
      senders["sms.prepaidDebit"](payload, context),
    ]);
    assert.deepEqual(await credits(), { balance: 4, totalUsed: 1 });
    assert.equal((await logs())[0]?.creditSource, "topup");
  });

  test("two different SMS taking their credits at once take one each", async () => {
    const first = acceptance();
    const second = acceptance();
    await records.recordSmsAcceptance(first);
    await records.recordSmsAcceptance(second);
    // Both wait for another write that holds the store's credits.
    await raceOnLockedRow(database, { table: "sms_credits", id: await creditsRowId() }, [
      () => records.takePrepaidSmsCredit(first.id, STORE),
      () => records.takePrepaidSmsCredit(second.id, STORE),
    ]);
    assert.deepEqual(await credits(), { balance: 3, totalUsed: 2 });
    assert.deepEqual(
      (await logs()).map((row) => row.creditSource),
      ["topup", "topup"],
    );
  });

  test("two SMS racing for the last credit: one takes it, the other's stays owed", async () => {
    await setBalance(1);
    const first = acceptance();
    const second = acceptance();
    // Both passed the quota check for the last credit, and went out.
    await records.recordSmsAcceptance(first);
    await records.recordSmsAcceptance(second);
    await raceOnLockedRow(database, { table: "sms_credits", id: await creditsRowId() }, [
      () => records.takePrepaidSmsCredit(first.id, STORE),
      () => records.takePrepaidSmsCredit(second.id, STORE),
    ]);
    assert.deepEqual(await credits(), { balance: 0, totalUsed: 1 }, "never below zero");
    assert.deepEqual(
      (await logs()).map((row) => row.creditSource).sort(),
      ["topup", "topup_unpaid"],
      "the debt is kept, not cleared",
    );
    // Tried again, the unpaid one changes nothing: its debt waits for a top-up.
    await records.takePrepaidSmsCredit(first.id, STORE);
    await records.takePrepaidSmsCredit(second.id, STORE);
    assert.deepEqual(await credits(), { balance: 0, totalUsed: 1 });
    assert.equal(await planLimits.getSmsPrepaidBalance(STORE), 0);

    // The next top-up pays it first, in its own transaction.
    await louezDb.db.transaction(async (tx) => {
      await tx
        .update(louezDb.smsCredits)
        .set({ balance: sql`${louezDb.smsCredits.balance} + 3` })
        .where(eq(louezDb.smsCredits.storeId, STORE));
      assert.equal(await records.collectUnpaidSmsCredits(tx, STORE), 1);
    });
    assert.deepEqual(await credits(), { balance: 2, totalUsed: 2 });
    assert.deepEqual(
      (await logs()).map((row) => row.creditSource),
      ["topup", "topup"],
    );
    assert.equal(await planLimits.getSmsPrepaidBalance(STORE), 2);
  });

  test("a top-up smaller than the debts pays the oldest, and keeps the rest owed", async () => {
    await setBalance(0);
    const owed = [acceptance(), acceptance(), acceptance()];
    for (const sms of owed) {
      await records.recordSmsAcceptance(sms);
      await records.takePrepaidSmsCredit(sms.id, STORE);
    }
    await louezDb.db.transaction(async (tx) => {
      await tx
        .update(louezDb.smsCredits)
        .set({ balance: 2 })
        .where(eq(louezDb.smsCredits.storeId, STORE));
      assert.equal(await records.collectUnpaidSmsCredits(tx, STORE), 2);
    });
    assert.deepEqual(await credits(), { balance: 0, totalUsed: 2 });
    assert.deepEqual(
      (await logs()).map((row) => [row.id, row.creditSource]),
      [
        [owed[0]?.id, "topup"],
        [owed[1]?.id, "topup"],
        [owed[2]?.id, "topup_unpaid"],
      ],
    );
  });

  test("the spendable balance counts the credits still owed as spent", async () => {
    await records.recordSmsAcceptance(acceptance());
    await records.recordSmsAcceptance(acceptance());
    // Balance 5, two credits queued, not taken yet.
    assert.deepEqual(await credits(), { balance: 5, totalUsed: 0 });
    assert.equal(await planLimits.getSmsPrepaidBalance(STORE), 3);
    await records.recordSmsAcceptance(acceptance({ creditSource: "plan" }));
    assert.equal(await planLimits.getSmsPrepaidBalance(STORE), 3, "a plan SMS owes nothing");
  });

  test("the acceptance check never queues behind a write of the same id", async () => {
    const sms = acceptance();
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      // An acceptance of that id, still being written.
      await holder.query(
        "INSERT INTO sms_logs (id, store_id, `to`, message, template_type, status, credit_source) VALUES (?, ?, ?, ?, ?, 'sent', 'plan')",
        [sms.id, STORE, sms.to, sms.message, sms.templateType],
      );
      const started = Date.now();
      await assert.rejects(records.isSmsAccepted(sms.id), (error: unknown) => {
        // MySQL's refusal to wait, under drizzle's error.
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code === "ER_LOCK_NOWAIT";
      });
      const waited = Date.now() - started;
      assert.ok(waited < 3_000, `bounded: ${waited} ms, far below the outbox's time`);

      // Committed while the check looks again: it sees it.
      const checking = records.isSmsAccepted(sms.id);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await holder.commit();
      assert.equal(await checking, true);
    } finally {
      await holder.end();
    }
  });

  test("an SMS of the plan's month queues no credit, and its acceptance happens once", async () => {
    const sms = acceptance({ creditSource: "plan" });
    const [one, two] = await Promise.all([
      records.recordSmsAcceptance(sms),
      records.recordSmsAcceptance(sms),
    ]);
    assert.deepEqual([one, two], [[], []]);
    assert.deepEqual(
      (await logs()).map((row) => row.creditSource),
      ["plan"],
    );
    assert.deepEqual(await debitRows(), []);
    assert.deepEqual(await credits(), { balance: 5, totalUsed: 0 });
  });

  async function creditsRowId() {
    const [row] = await louezDb.db
      .select({ id: louezDb.smsCredits.id })
      .from(louezDb.smsCredits)
      .where(eq(louezDb.smsCredits.storeId, STORE));
    assert.ok(row);
    return row.id;
  }
});
