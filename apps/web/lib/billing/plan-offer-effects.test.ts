import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { EffectSendContext, PlanOfferFacts } from "@louez/api/platform/effects";

import type { PlanOfferEffectDeps } from "./plan-offer-effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The sender's modules import "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

// The plan offer's senders, with fakes: the owner's e-mail goes out with the queued
// figures, once, and never once the offer no longer holds; a close or a click is one
// PostHog event, the same on every try.

const OFFER: PlanOfferFacts = {
  plan: "pro",
  source: "legacy",
  period: "current",
  month: "2026-11",
  currency: "eur",
  // Fees and rates at the public test values of fees.md §12: the sender only words them.
  paidMinor: 7240,
  planPriceMinor: 300,
  vatRateBps: 250,
  thresholdMinor: 308,
  savingsMinor: 6932,
};

describe("plan offer senders", () => {
  type Recipient = Awaited<ReturnType<PlanOfferEffectDeps["readRecipient"]>>;
  let sent: Array<Parameters<PlanOfferEffectDeps["sendPlanOfferEmail"]>[0]> = [];
  let captured: Array<Parameters<PlanOfferEffectDeps["captureProductServerEventOrThrow"]>[0]> = [];
  let recipient: Recipient = null;
  let delivered = false;
  let billing = true;

  const context: EffectSendContext = {
    effectId: "effect_plan_offer",
    row: { storeId: "store_po", reservationId: null, customerId: null },
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {},
  };

  let senders: ReturnType<typeof import("./plan-offer-effects").createPlanOfferEffectSenders>;

  before(async () => {
    const { createPlanOfferEffectSenders } = await import("./plan-offer-effects");
    senders = createPlanOfferEffectSenders({
      isBillingEnabled: () => billing,
      isEmailConfigured: () => true,
      isEmailDelivered: async (id) => {
        assert.equal(id, "effect_plan_offer");
        return delivered;
      },
      readRecipient: async (storeId) => {
        assert.equal(storeId, "store_po");
        return recipient;
      },
      sendPlanOfferEmail: async (input) => {
        sent.push(input);
        return { success: true };
      },
      captureProductServerEventOrThrow: async (input) => {
        captured.push(input);
        return undefined;
      },
    });
  });

  beforeEach(() => {
    sent = [];
    captured = [];
    delivered = false;
    billing = true;
    recipient = {
      to: "owner@example.test",
      storeName: "Brest Surf",
      country: "FR",
      primaryColor: undefined,
      onPlan: false,
      hasAdminDiscount: false,
    };
  });

  test("e-mails the owner the queued figures, keyed by the row", async () => {
    await senders["billing.planOfferEmail"]({ storeId: "store_po", offer: OFFER }, context);
    assert.equal(sent.length, 1);
    const [email] = sent;
    assert.equal(email?.id, "effect_plan_offer");
    assert.equal(email?.to, "owner@example.test");
    assert.equal(email?.plan, "Pro");
    assert.match(email?.paid ?? "", /^72,40\s€$/u);
    assert.match(email?.price ?? "", /^3,00\s€$/u);
    assert.match(email?.priceWithVat ?? "", /^3,08\s€$/u);
    assert.match(email?.savings ?? "", /^69,32\s€$/u);
    assert.equal(email?.locale, "fr");
    assert.match(email?.ctaUrl ?? "", /\/dashboard\?store=store_po$/);
  });

  test("sends nothing again, nor once the offer no longer holds", async () => {
    delivered = true;
    await senders["billing.planOfferEmail"]({ storeId: "store_po", offer: OFFER }, context);
    delivered = false;
    recipient = { ...recipient!, onPlan: true };
    assert.deepEqual(
      await senders["billing.planOfferEmail"]({ storeId: "store_po", offer: OFFER }, context),
      { skipped: "plan_in_force" },
    );
    recipient = { ...recipient, onPlan: false, hasAdminDiscount: true };
    assert.deepEqual(
      await senders["billing.planOfferEmail"]({ storeId: "store_po", offer: OFFER }, context),
      { skipped: "admin_discount" },
    );
    billing = false;
    assert.deepEqual(
      await senders["billing.planOfferEmail"]({ storeId: "store_po", offer: OFFER }, context),
      { skipped: "billing_off" },
    );
    assert.equal(sent.length, 0);
  });

  test("a click is one PostHog event with the store and the figures", async () => {
    await senders["billing.planOfferAnalytics"](
      {
        eventUuid: "0b0f6c2e-1f9b-4d7e-9a35-7f1a2b3c4d5e",
        occurredAt: "2026-11-17T10:00:00.000Z",
        event: "plan_offer_clicked",
        userId: "user_owner",
        storeId: "store_po",
        offer: OFFER,
      },
      context,
    );
    assert.equal(captured.length, 1);
    const [event] = captured;
    assert.equal(event?.distinctId, "user_owner");
    assert.equal(event?.event, "plan_offer_clicked");
    assert.equal(event?.properties?.store_id, "store_po");
    assert.equal(event?.properties?.paid_cents, 7240);
    assert.equal(event?.properties?.savings_cents, 6932);
    assert.deepEqual(event?.identity, {
      eventUuid: "0b0f6c2e-1f9b-4d7e-9a35-7f1a2b3c4d5e",
      occurredAt: "2026-11-17T10:00:00.000Z",
    });
  });
});
