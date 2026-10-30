import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeBillingOverview, localizedLabel } from "./billing-overview";
import type { BillingAccess } from "./billing-access";
import type { EffectivePolicy } from "./policy";
import type { PolicyV1 } from "@/lib/billing-sync/policies";

// What the "Facturation" card says, from the cached policy (design §6.1, README §8.4).
// Who sees it is in billing-access.test.ts. The policy uses the public test values
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
  role: BillingAccess["role"] = "owner",
): BillingAccess {
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
    const overview = describeBillingOverview(access(), "it");
    assert.equal(overview.offer, "Test commission");
    assert.equal(overview.notice, "Add a card.");
  });

  test("a store without a card: blocked", () => {
    assert.deepEqual(describeBillingOverview(access(), "fr"), {
      offer: "Commission de test",
      notice: "Ajoutez une carte.",
      blockedReason: "payment_method_required",
      readOnly: false,
    });
  });

  test("another block reads as such; an open store shows no block", () => {
    const overdue = access({
      terms: {
        ...access().policy.terms,
        reservations: { allowed: false, reason: "payment_overdue" },
      },
    });
    assert.equal(describeBillingOverview(overdue, "fr").blockedReason, "payment_overdue");
    const open = access({
      terms: { ...access().policy.terms, reservations: { allowed: true } },
      acceptsReservations: true,
    });
    assert.equal(describeBillingOverview(open, "fr").blockedReason, null);
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
    const overview = describeBillingOverview(pending, "fr");
    assert.equal(overview.offer, null);
    assert.equal(overview.notice, null);
    assert.equal(overview.blockedReason, "payment_method_required");
  });

  test("a platform admin's view is read-only", () => {
    assert.equal(describeBillingOverview(access({}, "platform_admin"), "fr").readOnly, true);
    assert.equal(describeBillingOverview(access({}, "owner"), "fr").readOnly, false);
  });
});
