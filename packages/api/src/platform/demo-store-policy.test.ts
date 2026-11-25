import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEMO_REFUSED_PROCEDURES,
  demoStoreRefusal,
  isRefusedOnDemoStore,
} from "./demo-store-policy";

// A demo store (packages/db demo-stores.ts) refuses what reaches outside its sandbox,
// by router path for the dashboard and by capability for the API and the MCP.

test("team invitations, Stripe, billing, slugs and paid image models are refused", () => {
  for (const path of [
    ["dashboard", "team", "invite"],
    ["dashboard", "payments", "startStripeOnboarding"],
    ["dashboard", "billing", "startCardSetup"],
    ["dashboard", "onlineStore", "updateSlug"],
    ["dashboard", "products", "removeImageBackground"],
    ["dashboard", "stores", "create"],
    ["dashboard", "integrations", "connectTulip"],
    ["dashboard", "apiKeys", "create"],
  ]) {
    assert.equal(isRefusedOnDemoStore(path), true, path.join("."));
  }
  for (const capability of [
    "team.inviteMember",
    "payments.startStripeOnboarding",
    "reservations.refundStripePayment",
    "products.enhanceImage",
  ]) {
    assert.equal(isRefusedOnDemoStore(["v1", "anything"], capability), true, capability);
  }
});

test("the visitor's daily work stays allowed", () => {
  for (const path of [
    ["dashboard", "reservations", "updateStatus"],
    ["dashboard", "payments", "record"],
    ["dashboard", "payments", "recordDepositReturn"],
    ["dashboard", "products", "update"],
    ["dashboard", "team", "listMembers"],
    ["dashboard", "settings", "updateBusinessHours"],
    // A one-segment path never matches an entry on its own.
    ["team"],
  ]) {
    assert.equal(isRefusedOnDemoStore(path), false, path.join("."));
  }
  assert.equal(isRefusedOnDemoStore(["x"], "reservations.updateStatus"), false);
});

test("every refused path names a router and a procedure", () => {
  for (const entry of DEMO_REFUSED_PROCEDURES) {
    assert.match(entry, /^[a-zA-Z]+\.[a-zA-Z]+$/, entry);
  }
});

test("the refusal is a FORBIDDEN error the dashboard translates", () => {
  const error = demoStoreRefusal();
  assert.equal(error.code, "FORBIDDEN");
  assert.equal(error.message, "errors.demoStoreActionDisabled");
});
