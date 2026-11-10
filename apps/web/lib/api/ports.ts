import type { ApiPorts } from "@louez/api";
import { isEmailConfigured } from "@louez/email";

import { runAfterCommit } from "@/lib/api/after-commit";
import { dispatchApiEffects } from "@/lib/api/effects";
import { dispatchApiJobs } from "@/lib/api/jobs";
import { productImagesPort } from "@/lib/api/product-images";
import { apiUrls } from "@/lib/api/urls";
import { billingPort } from "@/lib/billing/billing-port";
import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { reportServerError } from "@/lib/error-tracking";
import { getHostedBy } from "@/lib/hosting";
import { tulipInsurancePort } from "@/lib/integrations/tulip/insurance-port";
import { getStorePlan } from "@/lib/plan-limits";
import { apiStorage } from "@/lib/storage/api-storage";
import { getStripe, isConnectConfigured } from "@/lib/stripe/client";
import { newStorePort } from "@/lib/stores/new-store-port";

/**
 * What the app lends the agent-ready API (packages/api platform/ports.ts).
 * Every transport (RPC, OpenAPI, MCP, uploads) passes this same object.
 */
export const apiPorts: ApiPorts = {
  planFeatures: async (storeId) => {
    const plan = await getStorePlan(storeId);
    return { apiAccess: plan.features.apiAccess };
  },
  storage: apiStorage,
  afterCommit: runAfterCommit,
  urls: apiUrls,
  runReservationEffects,
  insurance: tulipInsurancePort,
  dispatchEffects: dispatchApiEffects,
  dispatchJobs: dispatchApiJobs,
  productImages: productImagesPort,
  newStores: newStorePort,
  hostedBy: getHostedBy,
  stripeConnect: () => (isConnectConfigured() ? getStripe() : null),
  billing: billingPort,
  team: {
    collaboratorLimit: async (storeId) => (await getStorePlan(storeId)).features.maxCollaborators,
    emailConfigured: isEmailConfigured,
  },
  reportError: reportServerError,
};
