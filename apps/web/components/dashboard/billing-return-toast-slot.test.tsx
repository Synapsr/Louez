import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isValidElement } from "react";

import { BillingReturnToastSlot } from "./billing-return-toast-slot";

// The toast of the return from Stripe Checkout exists in service mode only
// (louez-billing docs/api, README §12): elsewhere `?billing=refreshed` shows nothing.

const saved = {
  LOUEZ_BILLING: process.env.LOUEZ_BILLING,
  BILLING_SERVICE_URL: process.env.BILLING_SERVICE_URL,
};

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

afterEach(() => setEnv(saved));

test("self-hosted, or cloud without the service, mounts no billing return toast", () => {
  setEnv({ LOUEZ_BILLING: undefined, BILLING_SERVICE_URL: undefined });
  assert.equal(BillingReturnToastSlot(), null);
  setEnv({ LOUEZ_BILLING: "off", BILLING_SERVICE_URL: "https://billing.example.test" });
  assert.equal(BillingReturnToastSlot(), null);
  setEnv({ LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: undefined });
  assert.equal(BillingReturnToastSlot(), null);
});

test("service mode mounts the billing return toast", () => {
  setEnv({ LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: "https://billing.example.test" });
  assert.ok(isValidElement(BillingReturnToastSlot()));
});
