import type { ApiPorts } from "@louez/api";

import { runAfterCommit } from "@/lib/api/after-commit";
import { apiUrls } from "@/lib/api/urls";
import { getStorePlan } from "@/lib/plan-limits";
import { apiStorage } from "@/lib/storage/api-storage";

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
};
