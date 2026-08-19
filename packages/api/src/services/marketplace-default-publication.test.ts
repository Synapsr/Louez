import assert from "node:assert/strict";
import { test } from "node:test";

import { nextMarketplaceCohortRank } from "./marketplace-cohort";
import {
  runMarketplaceDefaultPublication,
  type MarketplaceDefaultPublicationDependencies,
} from "./marketplace-default-publication";

const completeChecklist = {
  addressAndGeolocation: true,
  activeProductWithImageAndPrice: true,
  stripeChargesEnabled: true,
  cgvPresent: true,
  marketplaceTermsAccepted: true,
  complete: true,
};

test("stays fully inert while the default-publication gate is off", async () => {
  const mustNotRun = async (): Promise<never> => {
    throw new Error("gated dependencies must not run");
  };
  const result = await runMarketplaceDefaultPublication(
    { enabled: false, launchCohortSize: 1_000 },
    {
      listCandidates: mustNotRun,
      evaluateChecklist: mustNotRun,
      publish: mustNotRun,
    },
  );

  assert.deepEqual(result, {
    enabled: false,
    candidates: 0,
    ownerDecidedSkipped: 0,
    nonConformingSkipped: 0,
    published: 0,
    unchanged: 0,
    publications: [],
    errors: [],
  });
});

test("skips stores whose owner has already decided", async () => {
  let evaluateCalls = 0;
  let publishCalls = 0;
  const dependencies: MarketplaceDefaultPublicationDependencies = {
    listCandidates: async () => [
      { storeId: "store-decided", ownerDecidedAt: new Date("2026-08-18T08:00:00Z") },
    ],
    evaluateChecklist: async () => {
      evaluateCalls += 1;
      return completeChecklist;
    },
    publish: async () => {
      publishCalls += 1;
      return { channel: null };
    },
  };

  const result = await runMarketplaceDefaultPublication(
    { enabled: true, launchCohortSize: 1_000 },
    dependencies,
  );

  assert.equal(result.ownerDecidedSkipped, 1);
  assert.equal(result.published, 0);
  assert.equal(evaluateCalls, 0);
  assert.equal(publishCalls, 0);
});

test("publishes a conforming store with terms-update consent and a cohort rank", async () => {
  let taken = 0;
  const dependencies: MarketplaceDefaultPublicationDependencies = {
    listCandidates: async () => [{ storeId: "store-conforming", ownerDecidedAt: null }],
    evaluateChecklist: async () => completeChecklist,
    publish: async () => {
      const cohortRank = nextMarketplaceCohortRank(taken, 1_000);
      if (cohortRank !== null) taken += 1;

      return {
        channel: {
          ownerDecidedAt: null,
          status: "published",
          termsAcceptedAt: null,
          consentBasis: "terms_update",
          statusReason: "default_publication",
          cohortRank,
        },
      };
    },
  };

  const result = await runMarketplaceDefaultPublication(
    { enabled: true, launchCohortSize: 1_000 },
    dependencies,
  );

  assert.equal(result.published, 1);
  assert.deepEqual(result.publications, [{ storeId: "store-conforming", cohortRank: 1 }]);
  assert.equal(taken, 1);
});
