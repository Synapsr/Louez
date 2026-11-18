import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  cohortNoticeOf,
  homeNextSteps,
  pickHomeNextStep,
  type HomeNextStepFacts,
} from "./util.next-step";

/** A store fresh from onboarding: online, empty, every offer still open. */
const fresh: HomeNextStepFacts = {
  dismissedNoticeIds: [],
  reeentAwaitsStripe: false,
  hasActiveProduct: false,
  hasRealReservation: false,
  testReservationStatus: null,
  canOfferPlan: true,
  visibilityHasNextStep: false,
  agentAssistantOffered: true,
  cohortNotice: "seats",
};

/** A product to book: the visibility guide opens with it. */
const withProduct: HomeNextStepFacts = {
  ...fresh,
  hasActiveProduct: true,
  visibilityHasNextStep: true,
};

describe("home next step: one card for the store's stage", () => {
  const stages: Array<[string, HomeNextStepFacts, string | null]> = [
    ["no product", fresh, "firstProduct"],
    ["reeent store waiting for Stripe, no product", { ...fresh, reeentAwaitsStripe: true }, "reeentStripe"],
    ["reeent store waiting for Stripe, with a product", { ...withProduct, reeentAwaitsStripe: true }, "reeentStripe"],
    ["a product, no test yet", withProduct, "testReservation"],
    ["a test running", { ...withProduct, testReservationStatus: "confirmed" }, "testReservation"],
    ["the test completed", { ...withProduct, testReservationStatus: "completed" }, "visibility"],
    ["the test cancelled", { ...withProduct, testReservationStatus: "cancelled" }, "visibility"],
    ["the test card closed", { ...withProduct, dismissedNoticeIds: ["test-reservation"] }, "visibility"],
    ["a real reservation, owner on a billing instance", { ...withProduct, hasRealReservation: true }, "planOffer"],
    ["a real reservation, not the owner", { ...withProduct, hasRealReservation: true, canOfferPlan: false }, "visibility"],
    [
      "the guide done, no plan to offer",
      { ...withProduct, hasRealReservation: true, canOfferPlan: false, visibilityHasNextStep: false },
      "agentAssistant",
    ],
    [
      "an agent connected",
      {
        ...withProduct,
        hasRealReservation: true,
        canOfferPlan: false,
        visibilityHasNextStep: false,
        agentAssistantOffered: false,
      },
      "cohort",
    ],
    [
      "nothing left to offer",
      {
        ...withProduct,
        hasRealReservation: true,
        canOfferPlan: false,
        visibilityHasNextStep: false,
        agentAssistantOffered: false,
        cohortNotice: null,
      },
      null,
    ],
  ];

  for (const [stage, facts, expected] of stages) {
    test(stage, () => {
      assert.equal(pickHomeNextStep(facts).step, expected);
    });
  }

  test("the test card goes once a real reservation exists", () => {
    const steps = homeNextSteps({ ...withProduct, hasRealReservation: true });
    assert.equal(steps.includes("testReservation"), false);
  });

  test("no plan offer before a real reservation: nothing has been paid", () => {
    assert.equal(homeNextSteps(withProduct).includes("planOffer"), false);
  });

  test("an empty plan offer hands its place to the next card", () => {
    assert.deepEqual(pickHomeNextStep({ ...withProduct, hasRealReservation: true }), {
      step: "planOffer",
      fallback: "visibility",
    });
  });

  test("only the plan offer has a fallback", () => {
    assert.deepEqual(pickHomeNextStep(withProduct), { step: "testReservation", fallback: null });
  });
});

describe("reeent launch notice", () => {
  const base = {
    billingEnabled: true,
    isFromReeent: false,
    hasLifetimeFeeWaiver: false,
    remainingSeats: 10,
    dismissedNoticeIds: [],
  };

  test("seats while some are left", () => {
    assert.equal(cohortNoticeOf(base), "seats");
    assert.equal(cohortNoticeOf({ ...base, remainingSeats: 0 }), null);
  });

  test("no seats pitch to a store that came from reeent", () => {
    assert.equal(cohortNoticeOf({ ...base, isFromReeent: true }), null);
  });

  test("the earned badge, wherever the store came from", () => {
    assert.equal(
      cohortNoticeOf({ ...base, isFromReeent: true, hasLifetimeFeeWaiver: true, remainingSeats: 0 }),
      "member",
    );
  });

  test("each state is closed on its own", () => {
    assert.equal(cohortNoticeOf({ ...base, dismissedNoticeIds: ["reeent-cohort-seats"] }), null);
    assert.equal(
      cohortNoticeOf({
        ...base,
        hasLifetimeFeeWaiver: true,
        dismissedNoticeIds: ["reeent-cohort-seats"],
      }),
      "member",
    );
    assert.equal(
      cohortNoticeOf({
        ...base,
        hasLifetimeFeeWaiver: true,
        dismissedNoticeIds: ["reeent-cohort-member"],
      }),
      null,
    );
  });

  test("nothing on an instance that does not bill", () => {
    assert.equal(cohortNoticeOf({ ...base, billingEnabled: false }), null);
  });
});
