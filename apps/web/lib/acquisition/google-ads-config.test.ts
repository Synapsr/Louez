import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readGoogleAdsConversionsConfig } from "./google-ads-config";

// A key's shape only: nothing is signed here.
const KEY = JSON.stringify({
  type: "service_account",
  client_email: "uploader@louez-test.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMII…\n-----END PRIVATE KEY-----\n",
});

const COMPLETE = {
  GOOGLE_ADS_CONVERSIONS_ENABLED: "true",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID: "987654321",
  GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY: KEY,
};

describe("readGoogleAdsConversionsConfig", () => {
  test("off without the flag, whatever else is set: a self-hosted instance sends nothing", () => {
    for (const flag of [undefined, "", "false", "1", "yes"]) {
      assert.deepEqual(
        readGoogleAdsConversionsConfig({ ...COMPLETE, GOOGLE_ADS_CONVERSIONS_ENABLED: flag }),
        { enabled: false, reason: "not_enabled" },
      );
    }
    assert.deepEqual(readGoogleAdsConversionsConfig({}), {
      enabled: false,
      reason: "not_enabled",
    });
  });

  test("on with the flag and every value, the customer id without its dashes", () => {
    assert.deepEqual(readGoogleAdsConversionsConfig(COMPLETE), {
      enabled: true,
      config: {
        customerId: "1234567890",
        conversionActionId: "987654321",
        loginCustomerId: null,
        serviceAccount: {
          clientEmail: "uploader@louez-test.iam.gserviceaccount.com",
          privateKey: "-----BEGIN PRIVATE KEY-----\nMII…\n-----END PRIVATE KEY-----\n",
        },
      },
    });
  });

  test("the key may be base64, and a manager account may be named", () => {
    const result = readGoogleAdsConversionsConfig({
      ...COMPLETE,
      GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY: Buffer.from(KEY).toString("base64"),
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "111-222-3333",
    });
    assert.equal(result.enabled, true);
    assert.equal(result.enabled && result.config.loginCustomerId, "1112223333");
    assert.equal(
      result.enabled && result.config.serviceAccount.clientEmail,
      "uploader@louez-test.iam.gserviceaccount.com",
    );
  });

  test("with the flag on, a missing or wrong value turns it off and is named, not shown", () => {
    const cases: Array<[Record<string, string | undefined>, RegExp]> = [
      [{ GOOGLE_ADS_CUSTOMER_ID: undefined }, /^GOOGLE_ADS_CUSTOMER_ID/],
      [{ GOOGLE_ADS_CUSTOMER_ID: "12345" }, /^GOOGLE_ADS_CUSTOMER_ID/],
      [
        { GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID: "customers/1/conversionActions/2" },
        /^GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID/,
      ],
      [{ GOOGLE_ADS_LOGIN_CUSTOMER_ID: "abc" }, /^GOOGLE_ADS_LOGIN_CUSTOMER_ID/],
      [{ GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY: undefined }, /^GOOGLE_DATA_MANAGER/],
      [{ GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY: "not-a-key" }, /^GOOGLE_DATA_MANAGER/],
      [
        { GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY: JSON.stringify({ client_email: "a@b.co" }) },
        /^GOOGLE_DATA_MANAGER/,
      ],
    ];
    for (const [change, reason] of cases) {
      const result = readGoogleAdsConversionsConfig({ ...COMPLETE, ...change });
      assert.equal(result.enabled, false, JSON.stringify(change));
      assert.match(!result.enabled ? result.reason : "", reason);
      assert.ok(!result.enabled && !result.reason.includes("PRIVATE KEY"));
    }
  });
});
