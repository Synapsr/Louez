import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LaunchChecklistView } from "@louez/api/contracts/launch";

import {
  homeSetupSteps,
  onlinePaymentsStepOf,
  type OnlinePaymentsContext,
  type OnlinePaymentsStep,
} from "./util.setup-steps";

// The home's setup checklist reads the store's launch checklist, the one
// agents read (stores.getLaunchChecklist). It shows the same steps as when it
// computed them from the home's metrics and the store row.

interface Facts {
  /** An active product, free ones included: the home's former activeProductCount > 0. */
  activeProduct: boolean;
  /** An active product priced above zero. */
  pricedProduct: boolean;
  intended: "payment" | "request";
  stripeChargeable: boolean;
  firstReservation: boolean;
  firstCompleted: boolean;
}

/** The steps the home showed before, from the same facts (setup-checklist.tsx until lot 8b). */
function formerSteps(facts: Facts, context: OnlinePaymentsContext) {
  const onlinePaymentsStep: OnlinePaymentsStep =
    facts.intended === "payment" ? (facts.stripeChargeable ? "done" : "todo") : "hidden";
  const isReeent = context === "reeent";
  const payments =
    onlinePaymentsStep === "hidden"
      ? []
      : [
          {
            key: "connectStripe",
            completed: onlinePaymentsStep === "done",
            href: "/dashboard/settings/payments",
            action: "setup.connectStripe",
            description: isReeent ? "connectStripeReeent" : "connectStripe",
          },
        ];
  return {
    onlinePaymentsStep,
    steps: [
      { key: "createAccount", completed: true },
      { key: "configureStore", completed: true },
      ...(isReeent ? payments : []),
      {
        key: "addFirstProduct",
        completed: facts.activeProduct,
        href: "/dashboard/products/new",
        action: "setup.addFirstProduct",
        description: "addFirstProduct",
      },
      ...(isReeent ? [] : payments),
      {
        key: "firstReservation",
        completed: facts.firstReservation,
        href: "/dashboard/reservations/new?source=onboarding",
        action: "setup.createReservation",
        description: "firstReservation",
        showStoreLink: true,
      },
      { key: "firstCompleted", completed: facts.firstCompleted, description: "firstCompleted" },
    ],
  };
}

const LINKS = { dashboard: "https://app.louez.test/dashboard" };

/** A launch checklist as the procedure answers it for these facts. */
function checklistOf(facts: Facts): LaunchChecklistView {
  const item = (key: LaunchChecklistView["items"][number]["key"], done: boolean) => ({
    key,
    status: done ? ("done" as const) : ("missing" as const),
    required: key === "storeInfo",
    title: key,
    why: key,
    tools: [],
    links: LINKS,
  });
  return {
    storeId: "store_1",
    online: true,
    storefrontUrl: "https://brest-surf.louez.test",
    canGoLive: true,
    blocking: [],
    catalog: { hasActiveProduct: facts.activeProduct, hasPricedProduct: facts.pricedProduct },
    bookingMode: {
      intended: facts.intended,
      effective: facts.intended === "payment" && facts.stripeChargeable ? "payment" : "request",
      stripeChargeable: facts.stripeChargeable,
    },
    items: [
      item("storeInfo", true),
      item("products", facts.pricedProduct),
      item("onlinePayments", facts.intended === "request" || facts.stripeChargeable),
    ],
    legalRequirements: null,
    warnings: [],
    milestones: {
      firstReservation: facts.firstReservation,
      firstCompletedReservation: facts.firstCompleted,
    },
    links: LINKS,
  };
}

describe("home setup steps", () => {
  test("the same steps as before, for every combination of facts and both contexts", () => {
    const flags = [false, true];
    // No product, only free ones, a priced one.
    const catalogs = [
      { activeProduct: false, pricedProduct: false },
      { activeProduct: true, pricedProduct: false },
      { activeProduct: true, pricedProduct: true },
    ];
    let cases = 0;
    for (const catalog of catalogs)
      for (const intended of ["payment", "request"] as const)
        for (const stripeChargeable of flags)
          for (const firstReservation of flags)
            for (const firstCompleted of flags)
              for (const context of ["default", "reeent"] as const) {
                const facts = {
                  ...catalog,
                  intended,
                  stripeChargeable,
                  firstReservation,
                  firstCompleted,
                };
                const former = formerSteps(facts, context);
                const checklist = checklistOf(facts);
                assert.deepEqual(homeSetupSteps(checklist, context), former.steps);
                assert.equal(onlinePaymentsStepOf(checklist), former.onlinePaymentsStep);
                cases += 1;
              }
    assert.equal(cases, 96);
  });

  test("a catalog of free products completes the first-product step; the launch still asks a price", () => {
    const checklist = checklistOf({
      activeProduct: true,
      pricedProduct: false,
      intended: "request",
      stripeChargeable: false,
      firstReservation: false,
      firstCompleted: false,
    });
    const steps = homeSetupSteps(checklist, "default");
    assert.equal(steps.find((step) => step.key === "addFirstProduct")?.completed, true);
    assert.equal(checklist.items.find((item) => item.key === "products")?.status, "missing");
  });

  test("without the first bookings (a connection that may not read reservations), they stay open", () => {
    const checklist = {
      ...checklistOf({
        activeProduct: true,
        pricedProduct: true,
        intended: "request",
        stripeChargeable: false,
        firstReservation: true,
        firstCompleted: true,
      }),
      milestones: null,
    };
    const steps = homeSetupSteps(checklist, "default");
    assert.equal(steps.find((step) => step.key === "firstReservation")?.completed, false);
    assert.equal(steps.find((step) => step.key === "firstCompleted")?.completed, false);
  });
});
