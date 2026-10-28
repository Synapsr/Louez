import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeBillingOverview, localizedLabel } from "./billing-overview";
import type { BillingHandoffAccess } from "./handoff-access";
import type { EffectivePolicy } from "./policy";
import type { PolicyV1 } from "@/lib/billing-sync/policies";

// What the "Facturation" card says, from the cached policy (design §6.1, README §8.4).
// Who sees it is in handoff-access.test.ts. The policy uses the public test values
// of fees.md (Q33): 250 bps, a 150 marketplace fee.

const POLICY: PolicyV1 = {
  schema: "louez.billing.policy/1",
  storeId: "ovw_store",
  version: 3,
  effectiveFrom: "2027-02-01T00:00:00Z",
  issuedAt: "2027-01-30T10:00:00Z",
  newStoresCreatedFrom: null,
  offerKey: "test-commission",
  invoicing: "service",
  currency: "EUR",
  applicationFee: {
    kind: "percent",
    rateBps: 250,
    minMinor: 0,
    maxMinor: null,
    excludeInsurance: false,
    appliesTo: ["rental"],
  },
  marketplaceFeeMinor: 150,
  reservations: { allowed: false, reason: "payment_method_required" },
  notice: { kind: "payment_method_missing", blockAt: null },
  stripeCustomerId: null,
  labels: {
    offer: { fr: "Commission de test", en: "Test commission", de: "Testprovision" },
    notice: { fr: "Ajoutez une carte.", en: "Add a card." },
  },
};

function access(
  overrides: Partial<EffectivePolicy> = {},
  role: BillingHandoffAccess["role"] = "owner",
): BillingHandoffAccess {
  return {
    role,
    policy: {
      source: "store",
      version: 3,
      isNew: true,
      legacyBillingApplies: false,
      policy: POLICY,
      terms: {
        invoicing: "service",
        currency: "EUR",
        applicationFee: POLICY.applicationFee,
        marketplaceFeeMinor: 150,
        reservations: POLICY.reservations,
      },
      acceptsReservations: false,
      ...overrides,
    },
  };
}

describe("describeBillingOverview", () => {
  test("labels in the user's language when the service sent it, otherwise English", () => {
    assert.equal(localizedLabel(POLICY.labels.offer, "fr"), "Commission de test");
    assert.equal(localizedLabel(POLICY.labels.offer, "de"), "Testprovision");
    assert.equal(localizedLabel(POLICY.labels.offer, "ja"), "Test commission");
    const overview = describeBillingOverview(access(), "it", false);
    assert.equal(overview.offer, "Test commission");
    assert.equal(overview.notice, "Add a card.");
  });

  test("a store without a card: blocked, and the main button opens the card page", () => {
    assert.deepEqual(describeBillingOverview(access(), "fr", false), {
      offer: "Commission de test",
      notice: "Ajoutez une carte.",
      blockedReason: "payment_method_required",
      readOnly: false,
      primaryPage: "/payment-method",
    });
  });

  test("other blocks open the overview; an open store shows no block", () => {
    const overdue = access({
      terms: {
        ...access().policy.terms,
        reservations: { allowed: false, reason: "payment_overdue" },
      },
    });
    assert.equal(describeBillingOverview(overdue, "fr", false).blockedReason, "payment_overdue");
    assert.equal(describeBillingOverview(overdue, "fr", false).primaryPage, "/");
    const open = access({
      terms: { ...access().policy.terms, reservations: { allowed: true } },
      acceptsReservations: true,
    });
    assert.equal(describeBillingOverview(open, "fr", false).blockedReason, null);
    assert.equal(describeBillingOverview(open, "fr", false).primaryPage, "/");
  });

  test("BILLING_GATE_DISABLED: the store takes reservations, so no block and no card notice", () => {
    const killSwitch = describeBillingOverview(access({ acceptsReservations: true }), "fr", true);
    assert.equal(killSwitch.blockedReason, null);
    assert.equal(killSwitch.notice, null);
    assert.equal(killSwitch.primaryPage, "/");
    // Another notice still shows: only a missing card is moot without the gate.
    const cardRemoved = access({
      acceptsReservations: true,
      policy: { ...POLICY, notice: { kind: "card_removed", blockAt: "2027-02-14T00:00:00Z" } },
    });
    assert.equal(describeBillingOverview(cardRemoved, "fr", true).notice, "Ajoutez une carte.");
  });

  test("a new store the service has not processed yet: no offer, blocked (fail closed)", () => {
    const pending = access({
      source: "fail_closed",
      version: null,
      policy: null,
      terms: {
        invoicing: "service",
        currency: null,
        applicationFee: { kind: "none" },
        marketplaceFeeMinor: 0,
        reservations: { allowed: false, reason: "payment_method_required" },
      },
    });
    const overview = describeBillingOverview(pending, "fr", false);
    assert.equal(overview.offer, null);
    assert.equal(overview.notice, null);
    assert.equal(overview.blockedReason, "payment_method_required");
  });

  test("a platform admin's view is read-only", () => {
    assert.equal(describeBillingOverview(access({}, "platform_admin"), "fr", false).readOnly, true);
    assert.equal(describeBillingOverview(access({}, "owner"), "fr", false).readOnly, false);
  });

  test("a platform admin cannot add a card: on a store without one the button opens the overview", () => {
    assert.deepEqual(describeBillingOverview(access({}, "platform_admin"), "fr", false), {
      offer: "Commission de test",
      notice: "Ajoutez une carte.",
      blockedReason: "payment_method_required",
      readOnly: true,
      primaryPage: "/",
    });
  });
});
