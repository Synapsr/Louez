import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The SMS quota, on the database: a plan SMS counts against the plan's monthly
// limit, a prepaid one only in the prepaid balance, never in both.

// Read at call time (lib/billing/mode.ts): the quota exists only with platform billing.
process.env.LOUEZ_BILLING = "cloud";

const USER = "user_sms_quota";
const STORE = "store_sms_quota_01";
// The Pro plan includes 50 SMS a month (lib/plans.ts).
const PRO_LIMIT = 50;

type CreditSource = "plan" | "topup_pending" | "topup_unpaid" | "topup" | null;

describe("SMS quota (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let planLimits: typeof import("./plan-limits");
  let sequence = 0;

  before(async () => {
    database = await createTestDatabase("sms_quota");
    louezDb = await import("@louez/db");
    planLimits = await import("./plan-limits");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "sms@quota.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: USER, name: "Kayaks", slug: "sms-quota" });
    await louezDb.db.insert(louezDb.subscriptions).values({
      storeId: STORE,
      planSlug: "pro",
      billingMode: "subscription",
      status: "active",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.smsLogs);
    await louezDb.db.delete(louezDb.smsCredits);
  });

  /** The prepaid balance the store holds, its credits already taken. */
  const setBalance = async (balance: number) => {
    await louezDb.db
      .insert(louezDb.smsCredits)
      .values({ storeId: STORE, balance, totalPurchased: balance });
  };

  const logSms = async (
    howMany: number,
    creditSource: CreditSource,
    { status = "sent", sentAt = new Date() }: { status?: string; sentAt?: Date } = {},
  ) => {
    if (howMany === 0) return;
    await louezDb.db.insert(louezDb.smsLogs).values(
      Array.from({ length: howMany }, () => {
        sequence += 1;
        return {
          id: `smsquota_${String(sequence).padStart(12, "0")}`,
          storeId: STORE,
          to: "+33612345678",
          message: "Kayaks",
          templateType: "reservation_cancelled",
          status,
          creditSource,
          sentAt,
        };
      }),
    );
  };

  test("prepaid SMS do not count against the plan: 50 plan and 5 prepaid of 10 leave 5", async () => {
    // Ten credits bought, five spent: the balance was debited to five.
    await setBalance(5);
    await logSms(PRO_LIMIT, "plan");
    await logSms(5, "topup");

    const quota = await planLimits.getSmsQuotaStatus(STORE);
    assert.equal(quota.planUsed, PRO_LIMIT);
    assert.equal(quota.planLimit, PRO_LIMIT);
    assert.equal(quota.prepaidBalance, 5);
    assert.equal(quota.remaining, 5);
    assert.equal(quota.totalAvailable, PRO_LIMIT + 5);
    assert.equal(quota.allowed, true);
    assert.equal(await planLimits.determineSmsSource(STORE), "topup");
    assert.deepEqual(await planLimits.canSendSms(STORE), {
      allowed: true,
      current: PRO_LIMIT,
      limit: PRO_LIMIT,
      planSlug: "pro",
    });
  });

  test("a prepaid SMS whose credit is still owed counts once, in the balance", async () => {
    await setBalance(7);
    await logSms(PRO_LIMIT, "plan");
    await logSms(1, "topup_pending");
    await logSms(1, "topup_unpaid");

    const quota = await planLimits.getSmsQuotaStatus(STORE);
    assert.equal(quota.planUsed, PRO_LIMIT);
    assert.equal(quota.prepaidBalance, 5);
    assert.equal(quota.remaining, 5);
    assert.equal(quota.allowed, true);
  });

  test("the plan counts its own SMS this month, older rows without a source among them", async () => {
    await logSms(30, "plan");
    await logSms(10, null);
    await logSms(4, "plan", { status: "failed" });
    await logSms(PRO_LIMIT, "plan", {
      sentAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15),
    });

    const quota = await planLimits.getSmsQuotaStatus(STORE);
    assert.equal(quota.planUsed, 40);
    assert.equal(quota.remaining, PRO_LIMIT - 40);
    assert.equal(quota.allowed, true);
    assert.equal(await planLimits.determineSmsSource(STORE), "plan");
  });

  test("prepaid SMS never use up the plan's SMS of the month", async () => {
    await setBalance(0);
    await logSms(10, "topup");

    const quota = await planLimits.getSmsQuotaStatus(STORE);
    assert.equal(quota.planUsed, 0);
    assert.equal(quota.remaining, PRO_LIMIT);
    assert.equal(await planLimits.determineSmsSource(STORE), "plan");
  });

  test("sending stops once the plan's SMS are spent and the balance is empty", async () => {
    await setBalance(0);
    await logSms(PRO_LIMIT, "plan");
    await logSms(10, "topup");

    const quota = await planLimits.getSmsQuotaStatus(STORE);
    assert.equal(quota.remaining, 0);
    assert.equal(quota.allowed, false);
  });
});
