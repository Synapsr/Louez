import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readBillingSyncConfig } from "./config";

// README §2: TLS is required, except a loopback host in development.

const KEYS = {
  BILLING_OUTBOUND_KEYS: JSON.stringify({ "louez-req-a": "a".repeat(40) }),
  BILLING_OUTBOUND_ACTIVE_KID: "louez-req-a",
  BILLING_RESPONSE_KEYS: JSON.stringify({ "billing-res-a": "b".repeat(40) }),
  BILLING_NEW_STORES_FROM: "2027-01-25T00:00:00Z",
};

function read(url: string, nodeEnv: string | undefined) {
  return readBillingSyncConfig({
    ...KEYS,
    BILLING_SERVICE_URL: url,
    NODE_ENV: nodeEnv,
  } as NodeJS.ProcessEnv);
}

describe("readBillingSyncConfig transport", () => {
  test("https is accepted in every environment", () => {
    for (const nodeEnv of ["production", "development", "test", undefined]) {
      assert.equal(read("https://billing.example.com", nodeEnv).ok, true, String(nodeEnv));
    }
  });

  test("plain http to a loopback host is accepted outside production", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      for (const url of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
        assert.equal(read(url, nodeEnv).ok, true, `${url} ${String(nodeEnv)}`);
      }
    }
  });

  test("plain http to a loopback host is refused in production", () => {
    for (const url of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
      const result = read(url, "production");
      assert.equal(result.ok, false, url);
      assert.ok(!result.ok && result.errors.some((error) => error.includes("must use https")), url);
    }
  });

  test("plain http to any other host is refused in every environment", () => {
    for (const nodeEnv of ["production", "development", undefined]) {
      assert.equal(read("http://billing.example.com", nodeEnv).ok, false, String(nodeEnv));
    }
  });
});
