import { isBillingSyncEnabled } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import {
  BILLING_RETURN_PATH,
  BILLING_RETURN_TARGET,
  type BillingReturnOutcome,
  billingReturnTarget,
} from "@/lib/billing/billing-return";
import { createBillingAlerts } from "@/lib/billing-sync/alerts";
import { pullStorePolicies } from "@/lib/billing-sync/policies";
import { log } from "@/lib/evlog";
import { createLoginUrl } from "@/lib/utils/util.url";

// What `GET /dashboard/billing/return` answers, apart from the Next.js calls that
// app/(dashboard)/dashboard/billing/return/route.ts passes in.

export type BillingReturnRequest = {
  /**
   * `connection` from next/server. Awaited first: with `cacheComponents`, `next build`
   * would otherwise run the handler without the billing variables and ship its 404 as
   * a static answer. During a prerender it never resolves.
   */
  readonly connection: () => Promise<void>;
  /** `after` from next/server: the Discord part of an alert runs after the answer. */
  readonly after: (task: () => Promise<void>) => void;
  readonly getUserId: () => Promise<string | null>;
  /** The server-side active store, never a value from the query (README §10 step 1). */
  readonly getStore: () => Promise<{ readonly id: string; readonly role: MemberRole } | null>;
};

export type BillingReturnAnswer =
  | { readonly kind: "not_found" }
  | { readonly kind: "redirect"; readonly to: string };

/**
 * "Back to Louez" from the billing pages (louez-billing docs/api, README §10 step 4):
 * pulls the active store's policies, so a card added there reopens bookings within
 * seconds, then goes to the settings with a toast. On any failure Louez keeps its
 * cache. Only in service mode (README §12).
 */
export async function answerBillingReturn(
  request: BillingReturnRequest,
): Promise<BillingReturnAnswer> {
  await request.connection();
  if (!isBillingSyncEnabled()) return { kind: "not_found" };

  if (!(await request.getUserId())) {
    return { kind: "redirect", to: createLoginUrl(BILLING_RETURN_PATH) };
  }
  const store = await request.getStore();
  if (!store) return { kind: "redirect", to: "/onboarding" };
  // Only the people the hand-off lets in (README §10 step 1) come back from it.
  if (store.role !== "owner" && store.role !== "platform_admin") {
    return { kind: "redirect", to: BILLING_RETURN_TARGET };
  }

  let outcome: BillingReturnOutcome = "pending";
  try {
    const result = await pullStorePolicies(store.id, {
      alerts: createBillingAlerts({ schedule: request.after }),
    });
    // Refused or conflicting versions leave the cache as it was: nothing to announce.
    if (result.outcome === "updated" && result.invalid === 0 && result.conflicts === 0) {
      outcome = "refreshed";
    }
  } catch (error) {
    log.error(
      "billing",
      `the policy pull of store ${store.id} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { kind: "redirect", to: billingReturnTarget(outcome) };
}
