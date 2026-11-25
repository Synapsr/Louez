import { isDemoStoreRow } from "@louez/db/demo-stores";

import { getCurrentStore } from "@/lib/store-context";

import { DEMO_ACTION_DISABLED_ERROR } from "./constants";

/**
 * The refusal of a dashboard action a demo store (lib/demo) never runs: a
 * Stripe page, a top-up, a phone number, a webhook, a provider lookup. Null
 * for any other store. Procedures refuse through the API's own policy
 * (packages/api platform/demo-store-policy.ts); this is for server actions.
 */
export async function refuseOnDemoStore(): Promise<{
  error: typeof DEMO_ACTION_DISABLED_ERROR;
} | null> {
  const store = await getCurrentStore();
  return isDemoStoreRow(store) ? { error: DEMO_ACTION_DISABLED_ERROR } : null;
}
