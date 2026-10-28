import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { PolicyReservations } from "@louez/db";

import {
  BILLING_CARD_STEP_FLAG,
  type BillingCardFlagSource,
  asksForBillingCard,
  isBillingCardStepFlagOn,
  onboardingBillingCardStores,
  showsBillingCardStep,
} from "./billing-card-step";
import { describeBillingOverview } from "./billing-overview";
import type { HandoffRole } from "./handoff";
import type { EffectivePolicy } from "./policy";

// The onboarding's "Billing card" step (M2 plan L6): its PostHog flag fails closed,
// and nothing is read outside service mode (louez-billing docs/api, README §12). The
// policy cases are in billing-card-step.db.test.ts.

/** A flag source that records what it was asked and answers `answer`. */
function flagSource(answer: () => Promise<boolean | undefined>) {
  const asked: Array<{ key: string; distinctId: string }> = [];
  const source: BillingCardFlagSource = {
    apiKey: "phc_test",
    client: () => ({
      isFeatureEnabled: async (key: string, distinctId: string) => {
        asked.push({ key, distinctId });
        return answer();
      },
    }),
  };
  return { source, asked };
}

describe("the billing card step's flag", () => {
  test("on only when PostHog answers true, for the user", async () => {
    const on = flagSource(async () => true);
    assert.equal(await isBillingCardStepFlagOn("user_1", on.source), true);
    assert.deepEqual(on.asked, [{ key: BILLING_CARD_STEP_FLAG, distinctId: "user_1" }]);

    const off = flagSource(async () => false);
    assert.equal(await isBillingCardStepFlagOn("user_1", off.source), false);
  });

  test("off without a PostHog key, and PostHog is not asked", async () => {
    for (const apiKey of [undefined, ""]) {
      const flags = flagSource(async () => true);
      const withoutKey = { ...flags.source, apiKey };
      assert.equal(await isBillingCardStepFlagOn("user_1", withoutKey), false, String(apiKey));
      assert.deepEqual(flags.asked, []);
    }
  });

  test("off when the flag is unknown to PostHog", async () => {
    const unknown = flagSource(async () => undefined);
    assert.equal(await isBillingCardStepFlagOn("user_1", unknown.source), false);
  });

  test("off when the evaluation fails, whether it throws or rejects", async () => {
    const rejects = flagSource(async () => {
      throw new Error("PostHog timed out");
    });
    assert.equal(await isBillingCardStepFlagOn("user_1", rejects.source), false);

    const throwing: BillingCardFlagSource = {
      apiKey: "phc_test",
      client: () => {
        throw new Error("no client");
      },
    };
    assert.equal(await isBillingCardStepFlagOn("user_1", throwing), false);
  });
});

describe("asksForBillingCard", () => {
  const policy = (reservations: PolicyReservations, acceptsReservations = reservations.allowed) =>
    ({
      source: "store",
      version: 1,
      isNew: true,
      legacyBillingApplies: false,
      policy: null,
      terms: {
        invoicing: "service",
        currency: null,
        applicationFee: { kind: "none" },
        marketplaceFeeMinor: 0,
        reservations,
      },
      acceptsReservations,
    }) satisfies EffectivePolicy;
  const needsCard = policy({ allowed: false, reason: "payment_method_required" });

  test("the owner, while the policy refuses reservations until a card is on file", () => {
    assert.equal(asksForBillingCard("owner", needsCard), true);
  });

  test("not while BILLING_GATE_DISABLED lets reservations through: the step would claim a block", () => {
    assert.equal(
      asksForBillingCard(
        "owner",
        policy({ allowed: false, reason: "payment_method_required" }, true),
      ),
      false,
    );
  });

  test("exactly when the billing settings' main button opens the card page", () => {
    const reservations: ReadonlyArray<PolicyReservations> = [
      { allowed: true },
      { allowed: false, reason: "payment_method_required" },
      { allowed: false, reason: "payment_overdue" },
      { allowed: false, reason: "suspended" },
    ];
    const roles: ReadonlyArray<HandoffRole> = ["owner", "platform_admin"];
    for (const role of roles) {
      for (const terms of reservations) {
        for (const acceptsReservations of [true, false]) {
          const effective = policy(terms, acceptsReservations);
          const overview = describeBillingOverview({ role, policy: effective }, "en", false);
          assert.equal(
            asksForBillingCard(role, effective),
            overview.primaryPage === "/payment-method",
            `${role} ${JSON.stringify(terms)} accepts=${acceptsReservations}`,
          );
        }
      }
    }
  });

  test("not once reservations are allowed, nor for another block", () => {
    assert.equal(asksForBillingCard("owner", policy({ allowed: true })), false);
    for (const reason of ["payment_overdue", "suspended"] as const) {
      assert.equal(asksForBillingCard("owner", policy({ allowed: false, reason })), false, reason);
    }
  });

  test("not for a platform admin's read-only session, nor for anybody else", () => {
    assert.equal(asksForBillingCard("platform_admin", needsCard), false);
    assert.equal(asksForBillingCard(null, needsCard), false);
  });
});

describe("showsBillingCardStep outside service mode", () => {
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

  test("self-hosted, billing off or cloud without the service: hidden, and PostHog is not asked", async () => {
    for (const env of [
      { LOUEZ_BILLING: undefined, BILLING_SERVICE_URL: undefined },
      { LOUEZ_BILLING: "off", BILLING_SERVICE_URL: "https://billing.example.test" },
      { LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: undefined },
    ]) {
      setEnv(env);
      for (const store of [null, { id: "acc_store", role: "owner" as const }]) {
        const flags = flagSource(async () => true);
        assert.equal(
          await showsBillingCardStep({
            userId: "user_1",
            isPlatformAdmin: false,
            stores: [store],
            flags: flags.source,
          }),
          false,
          `${JSON.stringify(env)} store=${store?.id ?? "none"}`,
        );
        assert.deepEqual(flags.asked, []);
      }
    }
  });
});

describe("onboardingBillingCardStores", () => {
  const active = (onboardingCompleted: boolean | null) => ({
    id: "acc_store",
    name: "Store",
    role: "owner" as const,
    onboardingCompleted,
  });
  const store = { id: "acc_store", role: "owner" };

  test("before any store, the store the flow will create", () => {
    assert.deepEqual(onboardingBillingCardStores(null), [null]);
  });

  test("a draft is the store the flow onboards", () => {
    assert.deepEqual(onboardingBillingCardStores(active(false)), [store]);
    assert.deepEqual(onboardingBillingCardStores(active(null)), [store]);
  });

  test("a completed store counts, after the payment step, and so does a new store on the way", () => {
    assert.deepEqual(onboardingBillingCardStores(active(true)), [store, null]);
  });
});
