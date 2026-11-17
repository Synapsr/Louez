import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getPlan } from "@/lib/plans";

import {
  decidePlanOffer,
  EU_STANDARD_VAT_BPS,
  fitsPlan,
  isPlanOfferDismissed,
  planOfferMonths,
  planOfferVatRateBps,
  withVatMinor,
  type PlanOfferCandidate,
  type PlanOfferInput,
} from "./plan-offer-core";

// When a plan would have cost a pay-as-you-go store less (docs/domain/plan-offer.md).
// The plans are the dashboard's own (lib/plans.ts), read rather than retyped: the
// repository's figures stay where they are kept (scripts/billing-prices.test.mjs).

const candidate = (slug: "pro" | "ultra"): PlanOfferCandidate => {
  const plan = getPlan(slug)!;
  return {
    slug,
    monthlyPriceMinor: plan.price * 100,
    limits: {
      products: plan.features.maxProducts,
      reservationsPerMonth: plan.features.maxReservationsPerMonth,
      customers: plan.features.maxCustomers,
      collaborators: plan.features.maxCollaborators,
    },
  };
};
const PRO = candidate("pro");
const ULTRA = candidate("ultra");
const FRANCE = EU_STANDARD_VAT_BPS.FR!;
const PRO_FR = withVatMinor(PRO.monthlyPriceMinor, FRANCE);
const ULTRA_FR = withVatMinor(ULTRA.monthlyPriceMinor, FRANCE);
const PRO_RESERVATIONS = PRO.limits.reservationsPerMonth!;

const SMALL = { products: 12, reservationsThisMonth: 40, customers: 80, collaborators: 1 };

const paying = (
  current: number,
  previous = 0,
  previousReservations = 40,
): PlanOfferInput["costs"] => [
  { period: "current", month: "2026-11", paidMinor: current, reservations: 40 },
  { period: "previous", month: "2026-10", paidMinor: previous, reservations: previousReservations },
];

const input = (overrides: Partial<PlanOfferInput> = {}): PlanOfferInput => ({
  source: "legacy",
  currency: "eur",
  country: "FR",
  plans: [ULTRA, PRO],
  standing: SMALL,
  costs: paying(0),
  ...overrides,
});

describe("planOfferVatRateBps", () => {
  test("is the standard rate of an EU country, French when the store gave none", () => {
    assert.equal(planOfferVatRateBps("FR"), FRANCE);
    assert.equal(planOfferVatRateBps("be"), EU_STANDARD_VAT_BPS.BE);
    assert.equal(planOfferVatRateBps("MC"), FRANCE);
    assert.equal(planOfferVatRateBps(null), FRANCE);
    assert.equal(planOfferVatRateBps(" "), FRANCE);
  });

  test("is 0 outside the EU", () => {
    assert.equal(planOfferVatRateBps("CH"), 0);
    assert.equal(planOfferVatRateBps("GB"), 0);
    assert.equal(planOfferVatRateBps("US"), 0);
  });
});

describe("withVatMinor", () => {
  test("adds the rate and rounds half up to the minor unit", () => {
    assert.equal(withVatMinor(1000, 2000), 1200);
    assert.equal(withVatMinor(1, 5000), 2); // 1.5
    assert.equal(withVatMinor(3, 1000), 3); // 3.3
    assert.equal(withVatMinor(1000, 0), 1000);
  });
});

describe("decidePlanOffer", () => {
  test("offers Pro once the month's payments pass Pro's price with the store's VAT", () => {
    assert.equal(decidePlanOffer(input({ costs: paying(PRO_FR) })), null);
    const offer = decidePlanOffer(input({ costs: paying(PRO_FR + 1) }));
    assert.deepEqual(offer, {
      plan: "pro",
      source: "legacy",
      period: "current",
      month: "2026-11",
      currency: "eur",
      paidMinor: PRO_FR + 1,
      planPriceMinor: PRO.monthlyPriceMinor,
      vatRateBps: FRANCE,
      thresholdMinor: PRO_FR,
      savingsMinor: 1,
    });
  });

  test("counts the VAT of the store's country", () => {
    // Just above Pro without VAT: a saving in Switzerland, none with Belgium's VAT.
    const paid = PRO.monthlyPriceMinor + 300;
    assert.equal(
      decidePlanOffer(input({ country: "CH", costs: paying(paid) }))?.thresholdMinor,
      PRO.monthlyPriceMinor,
    );
    assert.equal(decidePlanOffer(input({ country: "BE", costs: paying(paid) })), null);
  });

  test("falls back to the last closed month, and the running one wins when both pass", () => {
    const previous = decidePlanOffer(input({ costs: paying(1000, PRO_FR * 2) }));
    assert.equal(previous?.period, "previous");
    assert.equal(previous?.month, "2026-10");
    assert.equal(previous?.savingsMinor, PRO_FR);
    assert.equal(
      decidePlanOffer(input({ costs: paying(PRO_FR + 1, PRO_FR * 2) }))?.period,
      "current",
    );
  });

  test("offers Ultra to a store that outgrew one of Pro's limits, only when Ultra costs less", () => {
    const outgrown = { ...SMALL, reservationsThisMonth: PRO_RESERVATIONS + 1 };
    assert.equal(decidePlanOffer(input({ standing: outgrown, costs: paying(ULTRA_FR) })), null);
    const offer = decidePlanOffer(input({ standing: outgrown, costs: paying(ULTRA_FR + 1) }));
    assert.equal(offer?.plan, "ultra");
    assert.equal(offer?.thresholdMinor, ULTRA_FR);
    assert.equal(
      decidePlanOffer(
        input({
          standing: { ...SMALL, collaborators: PRO.limits.collaborators! + 1 },
          costs: paying(ULTRA_FR + 1),
        }),
      )?.plan,
      "ultra",
    );
  });

  test("weighs the compared month's reservations against Pro's monthly limit", () => {
    // Last month paid more than Pro, but with more reservations than Pro allows.
    const many = PRO_RESERVATIONS + 50;
    assert.equal(decidePlanOffer(input({ costs: paying(0, PRO_FR + 1, many) })), null);
    assert.equal(decidePlanOffer(input({ costs: paying(0, ULTRA_FR + 1, many) }))?.plan, "ultra");
    assert.equal(
      decidePlanOffer(input({ costs: paying(0, PRO_FR + 1, PRO_RESERVATIONS) }))?.plan,
      "pro",
    );
  });

  test("offers nothing without a plan the store can buy, or with no payment", () => {
    assert.equal(decidePlanOffer(input({ plans: [], costs: paying(ULTRA_FR * 2) })), null);
    assert.equal(
      decidePlanOffer(
        input({
          plans: [PRO],
          standing: { ...SMALL, products: PRO.limits.products! + 1 },
          costs: paying(ULTRA_FR * 2),
        }),
      ),
      null,
    );
    assert.equal(decidePlanOffer(input({ costs: [] })), null);
    assert.equal(decidePlanOffer(input({ costs: paying(-ULTRA_FR) })), null);
  });
});

describe("fitsPlan", () => {
  test("a store at a limit still fits; one past it does not", () => {
    const atLimit = PRO.limits.products!;
    assert.equal(fitsPlan({ ...SMALL, products: atLimit }, PRO), true);
    assert.equal(fitsPlan({ ...SMALL, products: atLimit + 1 }, PRO), false);
    assert.equal(fitsPlan({ ...SMALL, customers: PRO.limits.customers! + 1 }, PRO), false);
    assert.equal(
      fitsPlan(
        { products: 9999, reservationsThisMonth: 9999, customers: 9999, collaborators: 99 },
        ULTRA,
      ),
      true,
    );
  });
});

describe("isPlanOfferDismissed", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  test("a closed card stays closed 30 days", () => {
    assert.equal(isPlanOfferDismissed(null, now), false);
    assert.equal(isPlanOfferDismissed(new Date("2026-10-19T10:00:01Z"), now), true);
    assert.equal(isPlanOfferDismissed(new Date("2026-10-18T10:00:00Z"), now), false);
  });
});

describe("planOfferMonths", () => {
  test("names the running month and the one before, in UTC", () => {
    assert.deepEqual(planOfferMonths(new Date("2026-11-17T10:00:00Z")), {
      current: "2026-11",
      previous: "2026-10",
    });
    assert.deepEqual(planOfferMonths(new Date("2027-01-01T00:00:00Z")), {
      current: "2027-01",
      previous: "2026-12",
    });
  });
});
