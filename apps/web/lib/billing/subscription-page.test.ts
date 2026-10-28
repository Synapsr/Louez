import assert from "node:assert/strict";
import { test } from "node:test";

import { type NewStorePlanRow, describeNewStoreSubscriptionPage } from "./subscription-page";

// The plan page of a store the billing service bills (louez-billing docs/api, README
// §8.7): the plans at once, and the service's words for pay-as-you-go, never Louez's
// ladder or free reservations. The labels are fake ones.

const policyOf = (fr: string, en: string) => ({ policy: { labels: { offer: { fr, en } } } });
const STORE_POLICY = policyOf("Offre de test", "Test offer");
const DEFAULT_POLICY = policyOf("Offre par défaut de test", "Default test offer");
const ON_PRO: NewStorePlanRow = {
  billingMode: "subscription",
  planSlug: "pro",
  status: "active",
  stripeSubscriptionId: "sub_test",
  stripeCustomerId: "cus_test",
};

const describe = (row: NewStorePlanRow | null, wantsPayAsYouGoPreview = false, locale = "fr") =>
  describeNewStoreSubscriptionPage({
    row,
    wantsPayAsYouGoPreview,
    policy: STORE_POLICY,
    defaultPolicy: DEFAULT_POLICY,
    locale,
  });

test("without a plan: the grid, with the store's own offer for pay-as-you-go", () => {
  for (const wantsPayAsYouGoPreview of [false, true]) {
    assert.deepEqual(describe(null, wantsPayAsYouGoPreview), {
      kind: "plans",
      offerLabel: "Offre de test",
      hasLiveSubscription: false,
      canAccessBillingPortal: false,
    });
  }
  // A customer kept from an earlier checkout opens Stripe's portal.
  assert.deepEqual(
    describe({
      ...ON_PRO,
      billingMode: "pay_as_you_go",
      planSlug: "pay_as_you_go",
      stripeSubscriptionId: null,
    }),
    {
      kind: "plans",
      offerLabel: "Offre de test",
      hasLiveSubscription: false,
      canAccessBillingPortal: true,
    },
  );
});

test("on a plan: the offer it returns to, and plan buttons that change the subscription", () => {
  assert.deepEqual(describe(ON_PRO), {
    kind: "plans",
    offerLabel: "Offre par défaut de test",
    hasLiveSubscription: true,
    canAccessBillingPortal: true,
  });
  assert.deepEqual(describe(ON_PRO, true), {
    kind: "payg_preview",
    offerLabel: "Offre par défaut de test",
  });
  // A plan Stripe no longer collects is over: the store pays its own offer again.
  assert.deepEqual(describe({ ...ON_PRO, status: "cancelled" }), {
    kind: "plans",
    offerLabel: "Offre de test",
    hasLiveSubscription: false,
    canAccessBillingPortal: true,
  });
});

test("the label is in the reader's language, else English, and null before any policy", () => {
  assert.equal(describe(null, false, "en").offerLabel, "Test offer");
  assert.equal(describe(null, false, "de").offerLabel, "Test offer");
  const page = describeNewStoreSubscriptionPage({
    row: null,
    wantsPayAsYouGoPreview: false,
    policy: { policy: null },
    defaultPolicy: DEFAULT_POLICY,
    locale: "fr",
  });
  assert.equal(page.offerLabel, null);
});
