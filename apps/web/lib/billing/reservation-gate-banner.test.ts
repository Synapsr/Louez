import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { policyV1Schema } from "@/lib/billing-sync/policies";

import { canManageBilling, policyLabel, reservationGateBanner } from "./reservation-gate-banner";

// The dashboard's card gate banner (louez-billing docs/api, README §8.4): from the
// policy's `notice` and `labels.notice`, with Louez's generic text when the service sent
// no label (design §6.4).

function policy(overrides: Record<string, unknown>) {
  return policyV1Schema.parse({
    schema: "louez.billing.policy/1",
    storeId: "store_banner_0123456789",
    version: 1,
    effectiveFrom: "2026-12-01T00:00:00Z",
    issuedAt: "2026-11-20T10:00:00Z",
    newStoresCreatedFrom: null,
    offerKey: "test-legacy",
    invoicing: "louez_legacy",
    currency: "EUR",
    applicationFee: { kind: "none" },
    marketplaceFeeMinor: 0,
    reservations: { allowed: true },
    notice: null,
    stripeCustomerId: null,
    labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
    ...overrides,
  });
}

const NOTICE_LABELS = { fr: "Ajoutez une carte.", en: "Add a card.", de: "Karte hinzufügen." };

describe("reservationGateBanner", () => {
  test("an allowed policy with no notice, M2's only shape, shows nothing", () => {
    assert.equal(
      reservationGateBanner({ acceptsReservations: true, policy: policy({}) }, "fr"),
      null,
    );
  });

  test("the built-in and legacy policies show nothing", () => {
    assert.equal(reservationGateBanner({ acceptsReservations: true, policy: null }, "en"), null);
  });

  test("a closed gate pauses, with the service's label in the reader's language", () => {
    const blocked = policy({
      reservations: { allowed: false, reason: "payment_method_required" },
      notice: { kind: "payment_method_missing", blockAt: null },
      labels: { offer: { fr: "Offre", en: "Offer" }, notice: NOTICE_LABELS },
    });
    assert.deepEqual(reservationGateBanner({ acceptsReservations: false, policy: blocked }, "de"), {
      kind: "paused",
      label: "Karte hinzufügen.",
    });
    // A language the service did not write falls back to English.
    assert.deepEqual(reservationGateBanner({ acceptsReservations: false, policy: blocked }, "ja"), {
      kind: "paused",
      label: "Add a card.",
    });
  });

  test("fail closed: no version, so Louez's generic text", () => {
    assert.deepEqual(reservationGateBanner({ acceptsReservations: false, policy: null }, "fr"), {
      kind: "paused",
      label: null,
    });
  });

  test("a notice before its block is a notice", () => {
    const scheduled = policy({
      notice: { kind: "card_removed", blockAt: "2027-02-14T00:00:00Z" },
      labels: { offer: { fr: "Offre", en: "Offer" }, notice: NOTICE_LABELS },
    });
    assert.deepEqual(reservationGateBanner({ acceptsReservations: true, policy: scheduled }, "fr"), {
      kind: "notice",
      label: "Ajoutez une carte.",
    });
  });
});

test("policyLabel picks the reader's language, else English", () => {
  assert.equal(policyLabel(NOTICE_LABELS, "fr"), "Ajoutez une carte.");
  assert.equal(policyLabel(NOTICE_LABELS, "pt"), "Add a card.");
});

test("only the owner and a platform admin get the billing button", () => {
  assert.equal(canManageBilling("owner"), true);
  assert.equal(canManageBilling("platform_admin"), true);
  assert.equal(canManageBilling("member"), false);
  assert.equal(canManageBilling(undefined), false);
});
