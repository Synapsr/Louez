import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { GoogleAdsConversionsConfigResult } from "./google-ads-config";
import type { DataManagerClient, UploadedConversion } from "./google-data-manager";

// The "account created" conversion from the sign-up to Google (docs/analytics/lifecycle.md).
// Google is a fake client: nothing leaves the test.

const ON: GoogleAdsConversionsConfigResult = {
  enabled: true,
  config: {
    customerId: "1234567890",
    conversionActionId: "987654321",
    loginCustomerId: null,
    serviceAccount: { clientEmail: "uploader@louez-test.iam.gserviceaccount.com", privateKey: "" },
  },
};
const OFF: GoogleAdsConversionsConfigResult = { enabled: false, reason: "not_enabled" };

const HOUR = 3_600_000;
const SIGN_UP = new Date("2026-11-18T10:00:00.000Z");
const CLICK = new Date(SIGN_UP.getTime() - 20 * 60_000);
const AD_TOUCH = { gclid: "EAIaIQobChMI-test", utm_source: "google", ts: CLICK.toISOString() };

/** A fake Data Manager: records each upload, and fails while `failWith` is set. */
function fakeClient() {
  const uploads: UploadedConversion[] = [];
  let failWith: Error | null = null;
  const client: DataManagerClient = {
    async ingest(conversion) {
      if (failWith) throw failWith;
      uploads.push(conversion);
      return { requestId: `req-${uploads.length}` };
    },
  };
  return {
    client,
    uploads,
    fail(error: Error | null) {
      failWith = error;
    },
  };
}

describe("Google Ads conversions (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let eq: typeof import("drizzle-orm").eq;
  let record: typeof import("./google-ads-conversion-record");

  before(async () => {
    database = await createTestDatabase("google_ads_conversions");
    louezDb = await import("@louez/db");
    ({ eq } = await import("drizzle-orm"));
    record = await import("./google-ads-conversion-record");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.googleAdsConversions);
    await louezDb.db.delete(louezDb.users);
  });

  const createUser = async (id: string) => {
    await louezDb.db.insert(louezDb.users).values({ id, email: `${id}@example.test` });
  };

  const rowOf = async (userId: string) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.googleAdsConversions)
      .where(eq(louezDb.googleAdsConversions.userId, userId));
    return row;
  };

  const allRows = () => louezDb.db.select().from(louezDb.googleAdsConversions);

  test("an account from an ad click gets a pending conversion, consent denied", async () => {
    await createUser("ads_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });

    const row = await rowOf("ads_user");
    assert.ok(row);
    assert.equal(row.status, "pending");
    assert.equal(row.clickIdType, "gclid");
    assert.equal(row.clickId, "EAIaIQobChMI-test");
    assert.equal(row.clickedAt.toISOString(), CLICK.toISOString());
    assert.equal(row.convertedAt.toISOString(), SIGN_UP.toISOString());
    assert.equal(row.adUserDataConsent, "denied");
    assert.equal(row.adPersonalizationConsent, "denied");
    assert.equal(row.attempts, 0);
    // Not before the click is 6 hours old.
    assert.ok(row.nextAttemptAt.getTime() >= CLICK.getTime() + 6 * HOUR);
  });

  test("no click id, no touch, or the upload off: nothing is queued", async () => {
    await createUser("organic_user");
    await record.queueGoogleAdsConversion(
      "organic_user",
      { utm_source: "newsletter", ts: CLICK.toISOString() },
      { config: ON, now: SIGN_UP },
    );
    await record.queueGoogleAdsConversion("organic_user", null, { config: ON, now: SIGN_UP });
    await createUser("off_user");
    await record.queueGoogleAdsConversion("off_user", AD_TOUCH, { config: OFF, now: SIGN_UP });
    assert.deepEqual(await allRows(), []);
  });

  test("a second sign-up hook for the account keeps the first conversion", async () => {
    await createUser("twice_user");
    await record.queueGoogleAdsConversion("twice_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    await record.queueGoogleAdsConversion(
      "twice_user",
      { gclid: "another-click", ts: SIGN_UP.toISOString() },
      { config: ON, now: new Date(SIGN_UP.getTime() + HOUR) },
    );
    const rows = await allRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.clickId, "EAIaIQobChMI-test");
  });

  test("a failing database never fails the sign-up", async () => {
    // No user row: the foreign key refuses the insert, and the call still resolves.
    await record.queueGoogleAdsConversion("missing_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    assert.deepEqual(await allRows(), []);
  });

  test("off, the upload calls nobody", async () => {
    await createUser("ads_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    const google = fakeClient();
    const result = await record.uploadDueGoogleAdsConversions({
      config: { enabled: false, reason: "GOOGLE_ADS_CUSTOMER_ID is missing or not 10 digits" },
      client: google.client,
      now: new Date(SIGN_UP.getTime() + 24 * HOUR),
    });
    assert.equal(result.off, "GOOGLE_ADS_CUSTOMER_ID is missing or not 10 digits");
    assert.equal(google.uploads.length, 0);
    assert.equal((await rowOf("ads_user"))?.status, "pending");
  });

  test("uploaded once the click is 6 hours old, and once only", async () => {
    await createUser("ads_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    const google = fakeClient();

    const early = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(CLICK.getTime() + 5 * HOUR),
    });
    assert.equal(early.sent, 0);
    assert.equal(google.uploads.length, 0);

    const later = new Date(CLICK.getTime() + 7 * HOUR);
    const due = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: later,
    });
    assert.equal(due.sent, 1);
    assert.equal(google.uploads.length, 1);
    assert.equal(google.uploads[0]?.userId, "ads_user");
    assert.equal(google.uploads[0]?.clickId, "EAIaIQobChMI-test");

    const row = await rowOf("ads_user");
    assert.equal(row?.status, "sent");
    assert.equal(row?.requestId, "req-1");
    assert.equal(row?.attempts, 1);
    assert.equal(row?.sentAt?.toISOString(), later.toISOString());

    const again = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(later.getTime() + 48 * HOUR),
    });
    assert.equal(again.sent, 0);
    assert.equal(google.uploads.length, 1);
  });

  test("a failed upload is kept with its error and retried later, then abandoned", async () => {
    await createUser("ads_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    const google = fakeClient();
    google.fail(new Error("Upload refused: HTTP 403 PERMISSION_DENIED"));

    let now = new Date(CLICK.getTime() + 7 * HOUR);
    const first = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now,
    });
    assert.equal(first.failed, 1);
    let row = await rowOf("ads_user");
    assert.equal(row?.status, "failed");
    assert.equal(row?.attempts, 1);
    assert.equal(row?.lastError, "Upload refused: HTTP 403 PERMISSION_DENIED");
    assert.equal(row?.nextAttemptAt.getTime(), now.getTime() + 15 * 60_000);

    // Not before its retry is due.
    const tooSoon = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(now.getTime() + 60_000),
    });
    assert.equal(tooSoon.failed, 0);

    // Each run once due, until the eighth attempt gives it up.
    for (let attempt = 2; attempt <= 8; attempt += 1) {
      now = new Date(now.getTime() + 25 * HOUR);
      await record.uploadDueGoogleAdsConversions({ config: ON, client: google.client, now });
    }
    row = await rowOf("ads_user");
    assert.equal(row?.status, "abandoned");
    assert.equal(row?.attempts, 8);

    google.fail(null);
    await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(now.getTime() + 25 * HOUR),
    });
    assert.equal(google.uploads.length, 0);
  });

  test("a failure that recovers is sent at the next due run", async () => {
    await createUser("ads_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    const google = fakeClient();
    google.fail(new Error("No answer from datamanager.googleapis.com (TimeoutError)"));
    const now = new Date(CLICK.getTime() + 7 * HOUR);
    await record.uploadDueGoogleAdsConversions({ config: ON, client: google.client, now });
    google.fail(null);
    const retried = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(now.getTime() + HOUR),
    });
    assert.equal(retried.sent, 1);
    const row = await rowOf("ads_user");
    assert.equal(row?.status, "sent");
    assert.equal(row?.attempts, 2);
    assert.equal(row?.lastError, null);
  });

  test("a row another run holds is left to it, and taken over once its lease ends", async () => {
    await createUser("ads_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    const now = new Date(CLICK.getTime() + 7 * HOUR);
    await louezDb.db
      .update(louezDb.googleAdsConversions)
      .set({ status: "sending", attempts: 1, lockedUntil: new Date(now.getTime() + 60_000) })
      .where(eq(louezDb.googleAdsConversions.userId, "ads_user"));
    const google = fakeClient();

    await record.uploadDueGoogleAdsConversions({ config: ON, client: google.client, now });
    assert.equal(google.uploads.length, 0);

    const result = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(now.getTime() + 10 * 60_000),
    });
    assert.equal(result.sent, 1);
    assert.equal((await rowOf("ads_user"))?.attempts, 2);
  });

  test("a click past 90 days by the upload expires unsent", async () => {
    await createUser("late_user");
    const oldClick = new Date(SIGN_UP.getTime() - 89 * 24 * HOUR);
    await record.queueGoogleAdsConversion(
      "late_user",
      { gclid: "old-click", ts: oldClick.toISOString() },
      { config: ON, now: SIGN_UP },
    );
    const google = fakeClient();
    const result = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(oldClick.getTime() + 90 * 24 * HOUR + HOUR),
    });
    assert.equal(result.expired, 1);
    assert.equal(google.uploads.length, 0);
    assert.equal((await rowOf("late_user"))?.status, "expired");
  });

  test("finished rows are deleted after 30 days, and with their account", async () => {
    await createUser("ads_user");
    await createUser("other_user");
    await record.queueGoogleAdsConversion("ads_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    await record.queueGoogleAdsConversion("other_user", AD_TOUCH, { config: ON, now: SIGN_UP });
    const google = fakeClient();
    const sentAt = new Date(CLICK.getTime() + 7 * HOUR);
    await record.uploadDueGoogleAdsConversions({ config: ON, client: google.client, now: sentAt });
    assert.equal(google.uploads.length, 2);

    await louezDb.db.delete(louezDb.users).where(eq(louezDb.users.id, "other_user"));
    assert.equal(await rowOf("other_user"), undefined);

    const kept = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(sentAt.getTime() + 29 * 24 * HOUR),
    });
    assert.equal(kept.pruned, 0);
    const pruned = await record.uploadDueGoogleAdsConversions({
      config: ON,
      client: google.client,
      now: new Date(sentAt.getTime() + 31 * 24 * HOUR),
    });
    assert.equal(pruned.pruned, 1);
    assert.deepEqual(await allRows(), []);
  });
});
