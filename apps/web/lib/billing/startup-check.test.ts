import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { checkBillingSyncConfigAtStartup } from "./startup-check";

// In service mode a wrong BILLING_* variable stops the server; outside it, nothing
// changes (louez-billing docs/api, README §12).

const NAMES = [
  "LOUEZ_BILLING",
  "BILLING_SERVICE_URL",
  "BILLING_OUTBOUND_KEYS",
  "BILLING_OUTBOUND_ACTIVE_KID",
  "BILLING_RESPONSE_KEYS",
  "BILLING_NEW_STORES_FROM",
] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

function setEnv(values: Partial<Record<(typeof NAMES)[number], string>>) {
  for (const name of NAMES) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe("checkBillingSyncConfigAtStartup", () => {
  afterEach(() => setEnv(saved));

  test("outside service mode the variables are ignored", () => {
    const errors: string[] = [];
    setEnv({ LOUEZ_BILLING: "cloud", BILLING_OUTBOUND_KEYS: "not json" });
    assert.equal(
      checkBillingSyncConfigAtStartup({ error: (_tag, message) => errors.push(message) }),
      true,
    );
    setEnv({ BILLING_SERVICE_URL: "https://billing.example.com" });
    assert.equal(
      checkBillingSyncConfigAtStartup({ error: (_tag, message) => errors.push(message) }),
      true,
    );
    assert.deepEqual(errors, []);
  });

  test("in service mode, every problem is logged and the start is refused", () => {
    const errors: string[] = [];
    setEnv({ LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: "http://billing.example.com" });
    assert.equal(
      checkBillingSyncConfigAtStartup({ error: (_tag, message) => errors.push(message) }),
      false,
    );
    assert.ok(errors.some((line) => line.includes("BILLING_SERVICE_URL must use https")));
    assert.ok(errors.some((line) => line.includes("BILLING_OUTBOUND_KEYS is required")));
    assert.ok(errors.some((line) => line.includes("BILLING_NEW_STORES_FROM")));
    assert.equal(errors.at(-1), "billing service config is invalid, stopping");
  });

  test("a complete configuration starts", () => {
    setEnv({
      LOUEZ_BILLING: "cloud",
      BILLING_SERVICE_URL: "https://billing.example.com",
      BILLING_OUTBOUND_KEYS: JSON.stringify({ "louez-req-a": "a".repeat(40) }),
      BILLING_OUTBOUND_ACTIVE_KID: "louez-req-a",
      BILLING_RESPONSE_KEYS: JSON.stringify({ "billing-res-a": "b".repeat(40) }),
      BILLING_NEW_STORES_FROM: "2027-01-25T00:00:00Z",
    });
    assert.equal(checkBillingSyncConfigAtStartup({ error: () => assert.fail("logged") }), true);
  });
});
