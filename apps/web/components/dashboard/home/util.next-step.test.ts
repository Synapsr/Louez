import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canClaimLaunchSeat,
  homeNextSteps,
  isEstablishedStore,
  pickHomeNextStep,
  type HomeNextStepFacts,
} from "./util.next-step";

/** A store fresh from onboarding: online, empty, every offer still open. */
const fresh: HomeNextStepFacts = {
  dismissedNoticeIds: [],
  reeentAwaitsStripe: false,
  hasActiveProduct: false,
  established: false,
  hasRealReservation: false,
  testReservationStatus: null,
  canOfferPlan: true,
  visibilityHasNextStep: false,
  agentAssistantOffered: true,
  launchSeatOpen: true,
};

/** A product to book: the visibility guide opens with it. */
const withProduct: HomeNextStepFacts = {
  ...fresh,
  hasActiveProduct: true,
  visibilityHasNextStep: true,
};

/** A store that rents already: an accepted reservation, guide steps still open. */
const established: HomeNextStepFacts = {
  ...withProduct,
  established: true,
  hasRealReservation: true,
};

describe("home next step: one card for the store's stage", () => {
  const stages: Array<[string, HomeNextStepFacts, string | null]> = [
    ["no product", fresh, "firstProduct"],
    [
      "reeent store waiting for Stripe, no product",
      { ...fresh, reeentAwaitsStripe: true },
      "reeentStripe",
    ],
    [
      "reeent store waiting for Stripe, with a product",
      { ...withProduct, reeentAwaitsStripe: true },
      "reeentStripe",
    ],
    ["a product, no test yet", withProduct, "testReservation"],
    ["a test running", { ...withProduct, testReservationStatus: "confirmed" }, "testReservation"],
    ["the test completed", { ...withProduct, testReservationStatus: "completed" }, "visibility"],
    ["the test cancelled", { ...withProduct, testReservationStatus: "cancelled" }, "visibility"],
    [
      "the test card closed",
      { ...withProduct, dismissedNoticeIds: ["test-reservation"] },
      "visibility",
    ],
    [
      "a real request not accepted yet, owner on a billing instance",
      { ...withProduct, hasRealReservation: true },
      "planOffer",
    ],
    [
      "a real request not accepted yet, not the owner",
      { ...withProduct, hasRealReservation: true, canOfferPlan: false },
      "visibility",
    ],
    ["established, owner on a billing instance", established, "planOffer"],
    ["established, not the owner", { ...established, canOfferPlan: false }, "cohort"],
    [
      "established reeent member, not the owner",
      { ...established, canOfferPlan: false, launchSeatOpen: false },
      null,
    ],
    [
      "established, reeent store waiting for Stripe",
      { ...established, reeentAwaitsStripe: true },
      "reeentStripe",
    ],
    [
      "the guide done, no plan to offer",
      {
        ...withProduct,
        hasRealReservation: true,
        canOfferPlan: false,
        visibilityHasNextStep: false,
      },
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
        launchSeatOpen: false,
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

  test("an established store sees no getting-started card", () => {
    const gettingStarted = ["firstProduct", "testReservation", "visibility", "agentAssistant"];
    for (const facts of [
      established,
      { ...established, hasActiveProduct: false },
      { ...established, dismissedNoticeIds: ["test-reservation" as const] },
    ]) {
      const steps = homeNextSteps(facts);
      assert.deepEqual(
        steps.filter((step) => gettingStarted.includes(step)),
        [],
      );
    }
  });

  test("an established store with nothing to offer sees no card", () => {
    assert.deepEqual(
      pickHomeNextStep({
        ...established,
        canOfferPlan: false,
        launchSeatOpen: false,
      }),
      { step: null, fallback: null },
    );
  });

  test("an empty plan offer leaves an established store the next offer, not the guide", () => {
    assert.deepEqual(pickHomeNextStep(established), {
      step: "planOffer",
      fallback: "cohort",
    });
  });

  test("an established reeent member: an empty plan offer leaves the slot empty", () => {
    assert.deepEqual(pickHomeNextStep({ ...established, launchSeatOpen: false }), {
      step: "planOffer",
      fallback: null,
    });
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

describe("established store", () => {
  const none = {
    confirmedReservations: 0,
    ongoingReservations: 0,
    completedReservations: 0,
    allTimeRevenue: 0,
  };

  test("a new store is not established", () => {
    assert.equal(isEstablishedStore(none), false);
  });

  test("an accepted reservation makes it established", () => {
    assert.equal(isEstablishedStore({ ...none, confirmedReservations: 1 }), true);
    assert.equal(isEstablishedStore({ ...none, ongoingReservations: 1 }), true);
    assert.equal(isEstablishedStore({ ...none, completedReservations: 1 }), true);
  });

  test("a rental payment received makes it established", () => {
    assert.equal(isEstablishedStore({ ...none, allTimeRevenue: 40.5 }), true);
  });
});

describe("reeent launch seat on the home", () => {
  const base = {
    billingEnabled: true,
    isFromReeent: false,
    hasLifetimeFeeWaiver: false,
    publishedOnReeent: false,
    remainingSeats: 10,
    dismissedNoticeIds: [],
  };

  test("an invitation while the store can still claim a seat", () => {
    assert.equal(canClaimLaunchSeat(base), true);
  });

  test("nothing once the cohort is full", () => {
    assert.equal(canClaimLaunchSeat({ ...base, remainingSeats: 0 }), false);
  });

  test("nothing to a member: its badge stays in the sales channels settings", () => {
    assert.equal(canClaimLaunchSeat({ ...base, hasLifetimeFeeWaiver: true }), false);
    assert.equal(
      canClaimLaunchSeat({ ...base, isFromReeent: true, hasLifetimeFeeWaiver: true }),
      false,
    );
  });

  test("nothing to a store already published on reeent: the seat goes with the first publication", () => {
    assert.equal(canClaimLaunchSeat({ ...base, publishedOnReeent: true }), false);
  });

  test("nothing to a store that came from reeent", () => {
    assert.equal(canClaimLaunchSeat({ ...base, isFromReeent: true }), false);
  });

  test("nothing once closed", () => {
    assert.equal(
      canClaimLaunchSeat({ ...base, dismissedNoticeIds: ["reeent-cohort-seats"] }),
      false,
    );
  });

  test("nothing on an instance that does not bill", () => {
    assert.equal(canClaimLaunchSeat({ ...base, billingEnabled: false }), false);
  });
});
