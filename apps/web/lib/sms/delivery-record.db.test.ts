import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The record of an SMS the provider accepted, on the database: its log row
// and its prepaid credit, written once per record id however often it is
// tried, at once or from the outbox.

const USER = "user_sms_record";
const STORE = "store_sms_record_01";

describe("SMS delivery record (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let records: typeof import("./delivery-record");
  let smsEffects: typeof import("./sms-effects");
  let sequence = 0;

  before(async () => {
    database = await createTestDatabase("sms_delivery_record");
    louezDb = await import("@louez/db");
    records = await import("./delivery-record");
    smsEffects = await import("./sms-effects");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "sms@record.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: USER, name: "Kayaks", slug: "sms-record" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.smsLogs);
    await louezDb.db.delete(louezDb.smsCredits);
    await louezDb.db.delete(louezDb.apiEffects);
    await louezDb.db
      .insert(louezDb.smsCredits)
      .values({ storeId: STORE, balance: 5, totalPurchased: 5 });
  });

  const record = (
    overrides: Partial<import("./delivery-record").SmsDeliveryRecord> = {},
  ): import("./delivery-record").SmsDeliveryRecord => {
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
      sentAt: new Date("2030-06-01T12:00:00Z").toISOString(),
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
      .from(louezDb.smsLogs);

  test("a prepaid SMS takes one credit and one log row, however often it is written", async () => {
    const delivered = record();
    await records.recordSmsDelivery(delivered);
    await records.recordSmsDelivery(delivered);
    // Two tries at once: the credits' lock orders them, the second sees the first.
    await Promise.all([records.recordSmsDelivery(delivered), records.recordSmsDelivery(delivered)]);

    assert.deepEqual(await logs(), [
      { id: delivered.id, status: "sent", messageId: delivered.messageId, creditSource: "topup" },
    ]);
    assert.deepEqual(await credits(), { balance: 4, totalUsed: 1 });
  });

  test("an SMS of the plan's month takes no credit, and its record happens once too", async () => {
    const delivered = record({ creditSource: "plan" });
    await Promise.all([records.recordSmsDelivery(delivered), records.recordSmsDelivery(delivered)]);
    assert.equal((await logs()).length, 1);
    assert.deepEqual(await credits(), { balance: 5, totalUsed: 0 });
  });

  test("an empty prepaid balance is never driven below zero", async () => {
    await louezDb.db
      .update(louezDb.smsCredits)
      .set({ balance: 0 })
      .where(eq(louezDb.smsCredits.storeId, STORE));
    await records.recordSmsDelivery(record());
    assert.equal((await logs()).length, 1, "the SMS went out: its log row counts it");
    assert.deepEqual(await credits(), { balance: 0, totalUsed: 0 });
  });

  test("a record handed to the outbox is written once by its sender, even run twice", async () => {
    const delivered = record();
    await records.queueSmsDeliveryRecord(delivered);
    const [row] = await louezDb.db
      .select({
        type: louezDb.apiEffects.type,
        orderingKey: louezDb.apiEffects.orderingKey,
        payload: louezDb.apiEffects.payload,
      })
      .from(louezDb.apiEffects);
    assert.equal(row?.type, "sms.deliveryRecord");
    assert.equal(row?.orderingKey, `sms:${delivered.id}`);

    const senders = smsEffects.createSmsEffectSenders();
    const context = {
      signal: new AbortController().signal,
      throwIfAborted: () => {},
      assertClaim: async () => {},
    };
    const payload = row?.payload as import("./delivery-record").SmsDeliveryRecord;
    await senders["sms.deliveryRecord"](payload, context);
    // A sender whose outcome was lost runs again.
    await senders["sms.deliveryRecord"](payload, context);
    assert.equal((await logs()).length, 1);
    assert.deepEqual(await credits(), { balance: 4, totalUsed: 1 });
  });
});
