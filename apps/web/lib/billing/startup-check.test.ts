import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  checkBillingSyncConfigAtStartup,
  checkHostingAtStartup,
  checkPayAsYouGoOfferAtStartup,
} from "./startup-check";

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

  test("in production, plain http to a loopback host is refused", () => {
    const processEnv: Record<string, string | undefined> = process.env;
    const savedNodeEnv = processEnv.NODE_ENV;
    try {
      processEnv.NODE_ENV = "production";
      const errors: string[] = [];
      setEnv({
        LOUEZ_BILLING: "cloud",
        BILLING_SERVICE_URL: "http://localhost:3100",
        BILLING_OUTBOUND_KEYS: JSON.stringify({ "louez-req-a": "a".repeat(40) }),
        BILLING_OUTBOUND_ACTIVE_KID: "louez-req-a",
        BILLING_RESPONSE_KEYS: JSON.stringify({ "billing-res-a": "b".repeat(40) }),
        BILLING_NEW_STORES_FROM: "2027-01-25T00:00:00Z",
      });
      assert.equal(
        checkBillingSyncConfigAtStartup({ error: (_tag, message) => errors.push(message) }),
        false,
      );
      assert.ok(errors.some((line) => line.includes("BILLING_SERVICE_URL must use https")));
    } finally {
      if (savedNodeEnv === undefined) delete processEnv.NODE_ENV;
      else processEnv.NODE_ENV = savedNodeEnv;
    }
  });
});

describe("checkPayAsYouGoOfferAtStartup", () => {
  afterEach(() => setEnv(saved));

  const check = (rawPricing: string | undefined) => {
    const errors: string[] = [];
    const ok = checkPayAsYouGoOfferAtStartup(
      { error: (_tag, message) => errors.push(message) },
      rawPricing,
    );
    return { ok, errors };
  };

  test("with billing on, a malformed offer for new stores refuses the start", () => {
    setEnv({ LOUEZ_BILLING: "cloud" });
    assert.equal(check('{"flatRateCents":"a lot"}').ok, false);
    assert.equal(check("not json").ok, false);
    assert.match(check("not json").errors[0] ?? "", /PAYG_DEFAULT_PRICING/);
    assert.deepEqual(check('{"flatRateCents":10}'), { ok: true, errors: [] });
    assert.deepEqual(check(undefined), { ok: true, errors: [] }, "unset: the built-in ladder");
    assert.deepEqual(check("  "), { ok: true, errors: [] });
  });

  test("a self-hosted instance never reads it", () => {
    setEnv({});
    assert.deepEqual(check("not json"), { ok: true, errors: [] });
    setEnv({ LOUEZ_BILLING: "off" });
    assert.deepEqual(check("not json"), { ok: true, errors: [] });
  });
});

describe("checkHostingAtStartup", () => {
  const check = (louezBilling: string | undefined, louezHostedBy: string | undefined) => {
    const errors: string[] = [];
    const ok = checkHostingAtStartup(
      { error: (_tag, message) => errors.push(message) },
      { louezBilling, louezHostedBy },
    );
    return { ok, errors };
  };

  test("Louez Cloud without its hosting identity refuses the start", () => {
    // Its legal notices would lose the hosting line (design §7.1).
    const unset = check("cloud", undefined);
    assert.equal(unset.ok, false);
    assert.match(unset.errors[0] ?? "", /LOUEZ_HOSTED_BY=lumycloud/);
    assert.equal(check("cloud", "LumyCloud").ok, false, "a typo is not a host");
    assert.deepEqual(check("cloud", "lumycloud"), { ok: true, errors: [] });
  });

  test("a self-hosted instance starts, with an unknown host only logged", () => {
    assert.deepEqual(check(undefined, undefined), { ok: true, errors: [] });
    assert.deepEqual(check("off", undefined), { ok: true, errors: [] });
    const unknown = check(undefined, "acme");
    assert.equal(unknown.ok, true);
    assert.match(unknown.errors[0] ?? "", /not a known host/);
  });
});
