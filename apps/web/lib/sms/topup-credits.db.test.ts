import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// An SMS top-up credited from Stripe's checkout event, on the database:
// once, however often and however concurrently the event is delivered, with
// the debts of SMS sent on an empty balance paid once too.

const USER = "user_sms_topup";
const STORE = "store_sms_topup_001";
const OTHER_STORE = "store_sms_topup_002";

describe("SMS top-up credits (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let topups: typeof import("./topup-credits");
  let sequence = 0;

  before(async () => {
    database = await createTestDatabase("sms_topup_credits");
    louezDb = await import("@louez/db");
    topups = await import("./topup-credits");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "sms@topup.test" });
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: USER, name: "Kayaks", slug: "sms-topup" },
      { id: OTHER_STORE, userId: USER, name: "Bikes", slug: "sms-topup-other" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.smsLogs);
    await louezDb.db.delete(louezDb.smsCredits);
    await louezDb.db.delete(louezDb.smsTopupTransactions);
    await louezDb.db.insert(louezDb.smsCredits).values({ storeId: STORE, balance: 0 });
  });

  /** A pending top-up, as the checkout's creation writes it. */
  async function pendingTopup(quantity: number) {
    sequence += 1;
    const id = `topup_${String(sequence).padStart(15, "0")}`;
    await louezDb.db.insert(louezDb.smsTopupTransactions).values({
      id,
      storeId: STORE,
      quantity,
      unitPriceCents: 10,
      totalAmountCents: quantity * 10,
      status: "pending",
      stripeSessionId: `cs_${id}`,
    });
    return id;
  }

  /** SMS sent on an empty balance, whose credits are owed. */
  async function unpaidSms(count: number) {
    for (let index = 0; index < count; index += 1) {
      sequence += 1;
      await louezDb.db.insert(louezDb.smsLogs).values({
        id: `smslog_${String(sequence).padStart(14, "0")}`,
        storeId: STORE,
        to: "+33612345678",
        message: "Kayaks",
        templateType: "reservation_cancelled",
        status: "sent",
        creditSource: "topup_unpaid",
      });
    }
  }

  const paidEvent = (transactionId: string, overrides: Partial<{ storeId: string }> = {}) => ({
    transactionId,
    storeId: STORE,
    checkoutSessionId: `cs_${transactionId}`,
    paymentIntentId: `pi_${transactionId}`,
    ...overrides,
  });
  const credits = async () => {
    const [row] = await louezDb.db
      .select({
        balance: louezDb.smsCredits.balance,
        totalPurchased: louezDb.smsCredits.totalPurchased,
        totalUsed: louezDb.smsCredits.totalUsed,
      })
      .from(louezDb.smsCredits)
      .where(eq(louezDb.smsCredits.storeId, STORE));
    return row;
  };
  const statusOf = async (id: string) => {
    const [row] = await louezDb.db
      .select({
        status: louezDb.smsTopupTransactions.status,
        paymentIntent: louezDb.smsTopupTransactions.stripePaymentIntentId,
      })
      .from(louezDb.smsTopupTransactions)
      .where(eq(louezDb.smsTopupTransactions.id, id));
    return row;
  };
  const unpaidLeft = async () =>
    (
      await louezDb.db.select({ source: louezDb.smsLogs.creditSource }).from(louezDb.smsLogs)
    ).filter((row) => row.source === "topup_unpaid").length;

  test("two deliveries of the same event at once credit the top-up and pay the debts once", async () => {
    await unpaidSms(3);
    const id = await pendingTopup(100);
    // Both deliveries wait for another write that holds the top-up row.
    const outcomes = await raceOnLockedRow(database, { table: "sms_topup_transactions", id }, [
      () => topups.creditSmsTopup(paidEvent(id)),
      () => topups.creditSmsTopup(paidEvent(id)),
    ]);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.credited).sort((a, b) => a - b),
      [0, 100],
    );
    assert.deepEqual(await credits(), { balance: 97, totalPurchased: 100, totalUsed: 3 });
    assert.equal(await unpaidLeft(), 0);
    assert.deepEqual(await statusOf(id), { status: "completed", paymentIntent: `pi_${id}` });

    // Delivered again later: nothing more.
    assert.deepEqual(await topups.creditSmsTopup(paidEvent(id)), { credited: 0 });
    assert.deepEqual(await credits(), { balance: 97, totalPurchased: 100, totalUsed: 3 });
  });

  test("a top-up smaller than the debts is all spent on the oldest", async () => {
    await unpaidSms(5);
    const id = await pendingTopup(2);
    assert.deepEqual(await topups.creditSmsTopup(paidEvent(id)), { credited: 2 });
    assert.deepEqual(await credits(), { balance: 0, totalPurchased: 2, totalUsed: 2 });
    assert.equal(await unpaidLeft(), 3);
  });

  test("an event that does not match its top-up credits nothing", async () => {
    const id = await pendingTopup(10);
    // Another store's, or another session's.
    assert.deepEqual(await topups.creditSmsTopup(paidEvent(id, { storeId: OTHER_STORE })), {
      credited: 0,
    });
    assert.deepEqual(
      await topups.creditSmsTopup({ ...paidEvent(id), checkoutSessionId: "cs_other" }),
      { credited: 0 },
    );
    // A payment intent another top-up was credited for.
    const first = await pendingTopup(10);
    await topups.creditSmsTopup({ ...paidEvent(first), paymentIntentId: "pi_shared" });
    assert.deepEqual(
      await topups.creditSmsTopup({ ...paidEvent(id), paymentIntentId: "pi_shared" }),
      { credited: 0 },
    );
    assert.equal((await statusOf(id))?.status, "pending");
    assert.deepEqual(await credits(), { balance: 10, totalPurchased: 10, totalUsed: 0 });
  });

  test("a first top-up creates the store's credits", async () => {
    await louezDb.db.delete(louezDb.smsCredits);
    const id = await pendingTopup(50);
    assert.deepEqual(await topups.creditSmsTopup(paidEvent(id)), { credited: 50 });
    assert.deepEqual(await credits(), { balance: 50, totalPurchased: 50, totalUsed: 0 });
  });
});
